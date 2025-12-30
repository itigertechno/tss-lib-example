package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"runtime"
	"slices"
	"sync"
	"syscall/js"
	"time"

	"github.com/binance-chain/tss-lib/common"
	"github.com/binance-chain/tss-lib/ecdsa/keygen"
	"github.com/binance-chain/tss-lib/ecdsa/signing"
	"github.com/binance-chain/tss-lib/tss"
)

const (
	INVALID_PARAMS = 0
	TIMEOUT_EXCEED = 1
)

type PartyInput struct {
	ID        string `json:"id"`
	Moniker   string `json:"moniker"`
	UniqueKey string `json:"uniqueKey"`
}

type CurveType int

const (
	CURVE_ECDSA CurveType = 0
	CURVE_EDDSA CurveType = 1
)

// Тяжелое и долгое вычисление предварительных параметров.
func generatePreparams(this js.Value, args []js.Value) (result any) {
	console := js.Global().Get("console")

	defer func() {
		if r := recover(); r != nil {
			buf := make([]byte, 8000)
			n := runtime.Stack(buf, false)
			stackTrace := string(buf[:n])

			rType := fmt.Sprintf("%T", r)
			rVal := fmt.Sprintf("%v", r)

			console.Call("log", "panic in generatePreparams", rType, rVal, stackTrace)
			result = INVALID_PARAMS
		}
	}()

	timeoutSec := args[0].Int()
	timeout := time.Duration(timeoutSec) * time.Second

	curveType := args[1].Int()
	if curveType == int(CURVE_ECDSA) {
		tss.SetCurve(tss.S256())
	} else {
		tss.SetCurve(tss.Edwards())
	}

	start := time.Now()
	console.Call("log", "start generate preparams")
	preParams, err := keygen.GeneratePreParams(timeout)
	took := time.Since(start)
	console.Call("log", "end generate preparams, took", took.String(), "error", err)

	if err != nil {
		console.Call("log", "generate preparams err", err.Error())
		return TIMEOUT_EXCEED
	}

	bytesResult, err := json.Marshal(preParams)
	if err != nil {
		return INVALID_PARAMS
	}

	return string(bytesResult)
}

var genKeysMu sync.Mutex
var isGenerateKeysActive = false
var generateKeysParty tss.Party
var participants []*tss.PartyID

// Генерирует ключ для пользователя в интерактивном режиме,
// обмениваясь новыми сообщениями JS и принимая новые сообщения от JS.
//
// Возвращает json строку с keygen.LocalPartySaveData.
func generateKeys(this js.Value, args []js.Value) any {
	// Проверяем, запущена ли уже генерация ключей или нет.
	genKeysMu.Lock()
	if isGenerateKeysActive {
		genKeysMu.Unlock()
		return INVALID_PARAMS
	}
	genKeysMu.Unlock()

	// Обрабатываем параметры функции.
	if len(args) < 7 {
		return INVALID_PARAMS
	}

	if args[0].Type() != js.TypeString {
		return INVALID_PARAMS
	}
	currentID := args[0].String()

	if args[1].Type() != js.TypeString {
		return INVALID_PARAMS
	}
	participantsJSON := args[1].String()

	if args[2].Type() != js.TypeFunction {
		return INVALID_PARAMS
	}
	messageCallback := args[2]

	if args[3].Type() != js.TypeString {
		return INVALID_PARAMS
	}
	preParamsString := args[3].String()

	if args[4].Type() != js.TypeNumber {
		return INVALID_PARAMS
	}
	curveType := args[4].Int()

	if args[5].Type() != js.TypeNumber {
		return INVALID_PARAMS
	}
	timeoutSeconds := args[5].Int()

	if args[6].Type() != js.TypeFunction {
		return INVALID_PARAMS
	}
	resultCallback := args[6]

	go func() {
		console := js.Global().Get("console")

		genKeysMu.Lock()
		isGenerateKeysActive = true
		genKeysMu.Unlock()

		defer func() {
			if err := recover(); err != nil {
				buf := make([]byte, 8000)
				n := runtime.Stack(buf, false)
				stackTrace := string(buf[:n])

				console.Call("log", "generateKeys got panic", err, "stack trace:", stackTrace)

				resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))

				return
			}

			genKeysMu.Lock()
			isGenerateKeysActive = false
			generateKeysParty = nil
			participants = nil
			genKeysMu.Unlock()
		}()

		// Запускаем таймер для всей операции.
		timeout := time.Duration(timeoutSeconds) * time.Second
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()

		// Парсим список участников.
		var inputs []PartyInput
		if err := json.Unmarshal([]byte(participantsJSON), &inputs); err != nil {
			resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			return
		}

		// Парсим preParams
		var preParams keygen.LocalPreParams
		if err := json.Unmarshal([]byte(preParamsString), &preParams); err != nil {
			resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			return
		}

		// Устанавливаем тип кривой.
		if curveType == int(CURVE_ECDSA) {
			tss.SetCurve(tss.S256())
		} else {
			tss.SetCurve(tss.Edwards())
		}

		// Генерируем partyID и сортируем их.
		n := len(inputs)
		threshold := n / 2
		unsorted := make([]*tss.PartyID, 0, n)
		for _, p := range inputs {
			key := &big.Int{}
			key, ok := key.SetString(p.UniqueKey, 10)
			if !ok {
				resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
				return
			}

			pid := tss.NewPartyID(p.ID, p.Moniker, key)
			unsorted = append(unsorted, pid)
		}
		genKeysMu.Lock()
		participants = tss.SortPartyIDs(unsorted)
		genKeysMu.Unlock()

		// Создаем каналы для общения и p2p контекст.
		p2pCtx := tss.NewPeerContext(participants)
		outCh := make(chan tss.Message, 256)
		saveCh := make(chan keygen.LocalPartySaveData, 1)

		// Создаем localParty.
		genKeysMu.Lock()
		currentPartyIdx := slices.IndexFunc(participants, func(p *tss.PartyID) bool { return p.Id == currentID })
		genKeysMu.Unlock()
		if currentPartyIdx == -1 {
			resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			return
		}

		genKeysMu.Lock()
		currentPartyID := participants[currentPartyIdx]
		params := tss.NewParameters(tss.EC(), p2pCtx, currentPartyID, n, threshold)
		generateKeysParty = keygen.NewLocalParty(params, outCh, saveCh, preParams)
		genKeysMu.Unlock()

		// Стартуем партию.
		go func() {
			runtime.Gosched()
			if err := generateKeysParty.Start(); err != nil {
				console.Call("log", "start party error", err.Error())
			}
		}()

		// Слушаем входящие сообщения от party и отправляем их наружу через callback,
		// а также слушаем сообщение о получении сохраненных данных.
		var saveData keygen.LocalPartySaveData

		lastSched := time.Now()
		schedEvery := time.Duration(1) * time.Second

	Main:
		for {
			if time.Since(lastSched) < schedEvery {
				runtime.Gosched()
				lastSched = time.Now()
			}

			select {
			case m := <-outCh:
				wire, _, err := m.WireBytes()
				if err != nil {
					console.Call("log", "wire bytes error", err.Error())
					continue
				}

				from := m.GetFrom()
				toList := m.GetTo()
				isBroadcast := m.IsBroadcast()

				// Формируем сообщение для js.
				fromValue := js.ValueOf(from.Id)
				toListArray := make([]any, len(toList))
				for i, party := range toList {
					toListArray[i] = party.Id
				}
				toListValue := js.ValueOf(toListArray)
				wireArr := js.Global().Get("Uint8Array").New(len(wire))
				js.CopyBytesToJS(wireArr, wire)
				isBroadcastValue := js.ValueOf(isBroadcast)

				// Вызываем коллбэк нового сообщения.
				messageCallback.Invoke(fromValue, toListValue, wireArr, isBroadcastValue)
			case sd := <-saveCh:
				saveData = sd
				break Main
			case <-ctx.Done():
				isGenerateKeysActive = false

				resultCallback.Invoke(js.ValueOf(TIMEOUT_EXCEED))
				return
			}
		}

		bytesResult, err := json.Marshal(&saveData)
		if err != nil {
			resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			return
		}

		resultCallback.Invoke(js.ValueOf(string(bytesResult)))
	}()

	return "ok"
}

// Функция для обновления байтов текущей localParty при генерации ключа.
func generateKeysUpdateBytes(this js.Value, args []js.Value) (result any) {
	console := js.Global().Get("console")

	defer func() {
		if err := recover(); err != nil {
			buf := make([]byte, 8000)
			n := runtime.Stack(buf, false)
			stackTrace := string(buf[:n])

			console.Call("log", "generateKeys got panic", err, "stack trace:", stackTrace)

			result = INVALID_PARAMS
		}
	}()

	if len(args) < 3 {
		return INVALID_PARAMS
	}

	// Проверяем, запущена ли уже генерация ключей или нет.
	genKeysMu.Lock()
	if !isGenerateKeysActive {
		genKeysMu.Unlock()
		return INVALID_PARAMS
	}
	genKeysMu.Unlock()

	if args[0].Type() != js.TypeObject {
		return INVALID_PARAMS
	}
	jsBytesArray := args[0]
	if !jsBytesArray.InstanceOf(js.Global().Get("Uint8Array")) {
		return INVALID_PARAMS
	}

	if args[1].Type() != js.TypeString {
		return INVALID_PARAMS
	}
	fromID := args[1].String()

	if args[2].Type() != js.TypeBoolean {
		return INVALID_PARAMS
	}
	isBroadcast := args[2].Bool()

	// Копируем байты.
	wire := make([]byte, jsBytesArray.Get("byteLength").Int())
	js.CopyBytesToGo(wire, jsBytesArray)

	// Ищем partyID, от которого пришло сообщение.
	genKeysMu.Lock()
	fromIdx := slices.IndexFunc(participants, func(p *tss.PartyID) bool { return p.Id == fromID })
	if fromIdx == -1 {
		genKeysMu.Unlock()
		return INVALID_PARAMS
	}
	from := participants[fromIdx]
	genKeysMu.Unlock()

	_, err := generateKeysParty.UpdateFromBytes(wire, from, isBroadcast)

	if err != nil {
		console.Call("log", "update from bytes error", err.Error())
	}

	return "ok"
}

var signMu sync.Mutex
var isSignActive = false
var signParty tss.Party
var signParticipants []*tss.PartyID

// Подписывает сообщение интерактивно, получая байты от других подписей по p2p и вставляя их в текущую party.
//
// Возвращает json строку с common.SignatureData
func signMessage(this js.Value, args []js.Value) any {
	console := js.Global().Get("console")

	if len(args) < 8 {
		return INVALID_PARAMS
	}

	if args[0].Type() != js.TypeString {
		return INVALID_PARAMS
	}
	currentID := args[0].String()

	if args[1].Type() != js.TypeString {
		return INVALID_PARAMS
	}
	participantsJSON := args[1].String()

	var msgBytes []byte
	if args[2].Type() != js.TypeObject {
		return INVALID_PARAMS
	}
	arr := args[2]
	msgBytes = make([]byte, arr.Get("byteLength").Int())
	js.CopyBytesToGo(msgBytes, arr)

	if args[3].Type() != js.TypeString {
		return INVALID_PARAMS
	}
	saveDataJSON := args[3].String()

	if args[4].Type() != js.TypeNumber {
		return INVALID_PARAMS
	}
	curveType := args[4].Int()

	if args[5].Type() != js.TypeNumber {
		return INVALID_PARAMS
	}
	timeoutSeconds := args[5].Int()

	if args[6].Type() != js.TypeFunction {
		return INVALID_PARAMS
	}
	messageCallback := args[6]

	if args[7].Type() != js.TypeFunction {
		return INVALID_PARAMS
	}
	resultCallback := args[7]

	// Запускаем подписывание в горутине, чтобы не блокировать воркер и он мог принимать сообщения о новых байтах на подпись.
	go func() {
		signMu.Lock()
		if isSignActive {
			signMu.Unlock()
			resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			return
		}
		isSignActive = true
		signMu.Unlock()

		defer func() {
			if r := recover(); r != nil {
				buf := make([]byte, 8000)
				n := runtime.Stack(buf, false)
				stackTrace := string(buf[:n])
				console.Call("log", "signMessage panic", r, stackTrace)
				resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			}
			signMu.Lock()
			isSignActive = false
			signParty = nil
			signParticipants = nil
			signMu.Unlock()
		}()

		// Контекст с таймаутом.
		timeout := time.Duration(timeoutSeconds) * time.Second
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		_ = ctx
		defer cancel()

		// Парсим список участников.
		var inputs []PartyInput
		if err := json.Unmarshal([]byte(participantsJSON), &inputs); err != nil {
			resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			return
		}

		// Парсим saveData, полученные в generateKeys.
		var saveData keygen.LocalPartySaveData
		if err := json.Unmarshal([]byte(saveDataJSON), &saveData); err != nil {
			// возможно у тебя другой формат — поменяй декодер если нужно
			resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			return
		}

		// Устанавливаем кривую.
		if curveType == int(CURVE_ECDSA) {
			tss.SetCurve(tss.S256())
		} else {
			tss.SetCurve(tss.Edwards())
		}

		// Подготавливаем список участников.
		n := len(inputs)
		threshold := n / 2
		unsorted := make([]*tss.PartyID, 0, n)
		for _, p := range inputs {
			k := new(big.Int)
			k, ok := k.SetString(p.UniqueKey, 10)
			if !ok {
				resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
				return
			}
			unsorted = append(unsorted, tss.NewPartyID(p.ID, p.Moniker, k))
		}
		signMu.Lock()
		signParticipants = tss.SortPartyIDs(unsorted)
		signMu.Unlock()

		// Создаем каналы для общения и p2p контекст
		p2pCtx := tss.NewPeerContext(signParticipants)
		outCh := make(chan tss.Message, 256)
		endCh := make(chan *common.SignatureData, 1)

		// Находим индекс текущего пира в сортированном массиве участников.
		signMu.Lock()
		currentIdx := slices.IndexFunc(signParticipants, func(pp *tss.PartyID) bool { return pp.Id == currentID })
		signMu.Unlock()
		if currentIdx == -1 {
			resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
			return
		}
		currentPartyID := signParticipants[currentIdx]

		// Создаем сообщение
		msgBig := new(big.Int).SetBytes(msgBytes)

		// Создаем local party для подписи
		params := tss.NewParameters(tss.EC(), p2pCtx, currentPartyID, n, threshold)
		signMu.Lock()
		signParty = signing.NewLocalParty(msgBig, params, saveData, outCh, endCh)
		signMu.Unlock()

		// Запускаем local sign party
		go func() {
			runtime.Gosched()
			if err := signParty.Start(); err != nil {
				console.Call("log", "sign party start err", err.Error())
			}
		}()

	MainLoop:
		for {
			select {
			case m := <-outCh:
				wire, _, err := m.WireBytes()
				if err != nil {
					console.Call("log", "wire bytes error", err.Error())
					continue
				}
				from := m.GetFrom()
				toList := m.GetTo()
				isBroadcast := m.IsBroadcast()

				// Подготавливаем параметры для JS колбэка.
				toListArray := make([]any, len(toList))
				for i, p := range toList {
					toListArray[i] = p.Id
				}
				wireArr := js.Global().Get("Uint8Array").New(len(wire))
				js.CopyBytesToJS(wireArr, wire)

				messageCallback.Invoke(js.ValueOf(from.Id), js.ValueOf(toListArray), wireArr, js.ValueOf(isBroadcast))
			case sd := <-endCh:
				// Возвращаем результат после получения.
				bytesResult, err := json.Marshal(sd)
				if err != nil {
					resultCallback.Invoke(js.ValueOf(INVALID_PARAMS))
					return
				}
				resultCallback.Invoke(js.ValueOf(string(bytesResult)))
				break MainLoop

			case <-time.After(timeout):
				resultCallback.Invoke(js.ValueOf(TIMEOUT_EXCEED))
				return
			}
		}
	}()

	return js.ValueOf("ok")
}

// Функция для записи байтов входящих сообщений в текщую localParty при подписи сообщения.
func signMessageUpdateBytes(this js.Value, args []js.Value) any {
	console := js.Global().Get("console")

	if len(args) < 3 {
		return INVALID_PARAMS
	}
	if args[0].Type() != js.TypeObject || !args[0].InstanceOf(js.Global().Get("Uint8Array")) {
		return INVALID_PARAMS
	}
	// copy bytes
	arr := args[0]
	wire := make([]byte, arr.Get("byteLength").Int())
	js.CopyBytesToGo(wire, arr)

	if args[1].Type() != js.TypeString {
		return INVALID_PARAMS
	}
	fromID := args[1].String()

	if args[2].Type() != js.TypeBoolean {
		return INVALID_PARAMS
	}
	isBroadcast := args[2].Bool()

	// Находим индекс и partyID отправителя.
	signMu.Lock()
	idx := slices.IndexFunc(signParticipants, func(p *tss.PartyID) bool { return p.Id == fromID })
	if idx == -1 {
		signMu.Unlock()
		return INVALID_PARAMS
	}
	fromPartyID := signParticipants[idx]
	p := signParty
	signMu.Unlock()

	if p == nil {
		return INVALID_PARAMS
	}

	ok, err := p.UpdateFromBytes(wire, fromPartyID, isBroadcast)
	if err != nil {
		console.Call("log", "UpdateFromBytes error", err.Error())
	}
	return js.ValueOf(ok)
}

func main() {
	tss.SetCurve(tss.S256())

	js.Global().Set("generatePreParams", js.FuncOf(generatePreparams))
	js.Global().Set("generateKeys", js.FuncOf(generateKeys))
	js.Global().Set("generateKeysUpdateBytes", js.FuncOf(generateKeysUpdateBytes))
	js.Global().Set("signMessage", js.FuncOf(signMessage))
	js.Global().Set("signMessageUpdateBytes", js.FuncOf(signMessageUpdateBytes))

	// Keep the WASM module running
	select {}
}
