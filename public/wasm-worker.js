// Файл воркера для неблокирующей работы с долгой математикой в tss-lib.

self.onmessage = async (ev) => {
  const message = ev.data;
  const type = message.type;
  const payload = message.payload;

  try {
    if (!type) {
      throw new Error("неизвестная команда");
    }

    if (type == "init") {
      // Инициализируем wasm скрипт.
      importScripts("/wasm_exec.js");

      // wasm_exec.js должен определить Go.
      const go = new Go();

      // Импортируем и запускаем wasm файл.
      const response = await fetch("/tss.wasm");
      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(
        bytes,
        go.importObject
      );

      go.run(instance);

      await new Promise(resolve => setTimeout(resolve, 1000))

      sendInitDone()

      return;
    }

    if (type == "generatePreParams") {
      // Запускаем команду генерации предварительных параметров.
      const timeout = payload.timeout;
      const curveType = payload.curveType;

      const result = self.generatePreParams(timeout, curveType);

      sendGeneratedPreparamsResult(result);

      return
    }

    if (type == "generateKeys") {
      // Запускаем команду генерации ключей.
      const id = payload.id
      const participantsJson = payload.participants;
      const preParams = payload.preParams
      const curveType = payload.curveType
      const timeout = payload.timeout;

      new Promise(() => {
        const result = self.generateKeys(id, participantsJson, sendGenerateKeysNewMessage, preParams, curveType, timeout, (result) => {
          sendGeneratedKeysResult(result)
        });
        if (result != "ok") {
          sendGeneratedKeysResult(result)
        }
      })

      return
    }

    if (type == "generateKeysUpdateBytes") {
      // Запускаем команду отправки обновления байтов при генерации ключа.
      const bytes = payload.bytes
      const id = payload.fromId
      const isBroadcast = payload.isBroadcast

      self.generateKeysUpdateBytes(bytes, id, isBroadcast)
    }

    if (type == "signMessage") {
      // Запускаем команду подписи сообщения.
      const id = payload.id
      const participantsJSON = payload.participants
      const messageBytes = payload.message
      const saveDataJSON = payload.saveData
      const curveType = payload.curveType
      const timeout = payload.timeout

      new Promise(() => {
        const result = self.signMessage(id, participantsJSON, messageBytes, saveDataJSON, curveType, timeout, sendSignMessageNewMessage, (result) => {
          sendSignMessageResult(result)
        })
        if (result != "ok") {
          sendSignMessageResult(result)
        }
      })

      return
    }

    if (type == "signMessageUpdateBytes") {
      // Запускаем команду отправки обновления байтов при подписи сообщения.
      const bytes = payload.bytes
      const id = payload.fromId
      const isBroadcast = payload.isBroadcast

      self.signMessageUpdateBytes(bytes, id, isBroadcast)
    }

  } catch (e) {
    sendError(e.message);
  }
};

function sendError(message) {
  self.postMessage({ type: "error", payload: message });
}

function sendInitDone() {
  self.postMessage({ type: "initDone", payload: "" })
}

function sendGeneratedPreparamsResult(result) {
  self.postMessage({ type: "generatedPreparamsResult", payload: result });
}

function sendGenerateKeysNewMessage(fromId, toIdList, bytes, isBroadcast) {
  self.postMessage({
    type: "generateKeysNewMessage", payload: {
      fromId, toIdList, bytes, isBroadcast
    }
  })
}

function sendGeneratedKeysResult(result) {
  self.postMessage({ type: "generatedKeysResult", payload: result });
}

function sendSignMessageNewMessage(fromId, toIdList, bytes, isBroadcast) {
  self.postMessage({
    type: "signMessageNewMessage", payload: {
      fromId, toIdList, bytes, isBroadcast
    }
  })
}

function sendSignMessageResult(result) {
  self.postMessage({ type: "signMessageResult", payload: result })
}