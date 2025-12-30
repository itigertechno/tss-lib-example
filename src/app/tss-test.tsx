"use client";

import classes from "./tss-test.module.css";

import { useCallback, useEffect, useState } from "react";

import {
  ParametersException,
  PreParams,
  TimeoutExceedException,
  TssState,
  TssWorker,
  useTssContext,
} from "@/shared/lib/tss";

export default function TestTSS() {
  const tssContext = useTssContext();

  const [preParamsState1, setPreParamsState1] = useState("");
  const [preParamsState2, setPreParamsState2] = useState("");

  // Храним сгенерированные preParams как строку, поскольку большие числа js переводит в Infinity
  const [preParams1, setPreParams1] = useState<string | null>(null);
  const [preParams2, setPreParams2] = useState<string | null>(null);

  // Храним generatedKeys как строку, поскольку большие числа js переводит в Infinity
  const [generateKeysState, setGenerateKeysState] = useState("");
  // В целях экономии времени сохраняем сгенерированные ключи в localStorage.
  const [keys1, setKeys1] = useState<string | null>(null)
  const [keys2, setKeys2] = useState<string | null>(null)

  const [signMessageState, setSignMessageState] = useState("")
  const [sign, setSign] = useState("")

  // Парсим сохраненное значение preParams.
  useEffect(() => {
    const savedValue1 = localStorage.getItem("preParams");
    if (savedValue1) {
      setPreParams1(savedValue1);
      setPreParamsState1(
        "Примечание: есть сохраненные preParams с предыдущего запуска, можно переходить к следующему этапу"
      );
    }

    const savedValue2 = localStorage.getItem("preParams2");
    if (savedValue2) {
      setPreParams2(savedValue2);
      setPreParamsState2(
        "Примечание: есть сохраненные preParams с предыдущего запуска, можно переходить к следующему этапу"
      );
    }
  }, []);

  // Парсим сохраненное значение saveData (ключей).
  useEffect(() => {
    let first = false
    const savedValue1 = localStorage.getItem("saveData1")
    if (savedValue1) {
      setKeys1(savedValue1)
      first = true
    }

    let second = false
    const savedValue2 = localStorage.getItem("saveData2")
    if (savedValue2) {
      setKeys2(savedValue2)
      second = true
    }

    if (first && second) {
      setGenerateKeysState("Примечание: есть сохраненные ключи с предыдущего запуска, можно переходить к следующему этапу")
    }
  }, [])

  const handleGeneratePreParams1 = useCallback(async () => {
    const timeout = 700;

    try {
      const start = Date.now();
      setPreParamsState1("Генерация началась");
      const result = await tssContext.generatePreParams(timeout, 0);
      const end = Date.now();
      setPreParamsState1(
        "Генерация завершена, потрачено " + (end - start) / 1000 + "с."
      );

      console.log("generate pre params result", result);

      if (typeof result == "string") {
        localStorage.setItem("preParams", result);
        setPreParams1(result);
      }
    } catch (e) {
      if (e instanceof ParametersException) {
        setPreParamsState1("В функцию переданы неверные параметры");
        return;
      }

      if (e instanceof TimeoutExceedException) {
        setPreParamsState1("Таймер операции закончился");
        return;
      }

      setPreParamsState1("Неизвестная ошибка: " + (e as Error).message);
    }
  }, []);

  const handleGeneratePreParams2 = useCallback(async () => {
    const timeout = 700;

    try {
      const start = Date.now();
      setPreParamsState2("Генерация началась");
      const result = await tssContext.generatePreParams(timeout, 0);
      const end = Date.now();
      setPreParamsState2(
        "Генерация завершена, потрачено " + (end - start) / 1000 + "с."
      );

      console.log("generate pre params result", result);

      if (typeof result == "string") {
        localStorage.setItem("preParams2", result);
        setPreParams2(result);
      }
    } catch (e) {
      if (e instanceof ParametersException) {
        setPreParamsState2("В функцию переданы неверные параметры");
        return;
      }

      if (e instanceof TimeoutExceedException) {
        setPreParamsState2("Таймер операции закончился");
        return;
      }

      setPreParamsState2("Неизвестная ошибка: " + (e as Error).message);
    }
  }, []);

  const handleGenerateKeys = useCallback(async () => {
    if (!preParams1 || !preParams2) {
      alert("Сначала сгенерируйте preParams");
      return;
    }

    const participants = [
      {
        id: "alice",
        moniker: "Alice",
        uniqueKey: "1",
      },
      { id: "bob", moniker: "Bob", uniqueKey: "2" },
    ]

    // Генерация ключей для первого пользователя (текущий браузер).
    const [updater1, promise1] = tssContext.generateKeys("alice", participants, preParams1, (fromId, toIdList, bytes, isBroadcast) => {
      updater2(fromId, bytes, isBroadcast)
    }, 0, 720)

    // Костыль для генерации ключей для второго пользователя (симуляция другой машины).
    const bobWorker = new TssWorker()
    const bobMessageHandler = (payload: any) => {
    }
    const bobErrorHandler = (err: string) => {
      console.log("bob worker error", err)
    }
    bobWorker.init(bobMessageHandler, bobErrorHandler)

    // Дадим время на инициализацию воркера.
    await new Promise(r => setTimeout(r, 1000))

    // Генерация ключей для второго пользователя (другая машина).
    const [updater2, promise2] = tssContext.generateKeys("bob", participants, preParams2, (fromId, toIdList, bytes, isBroadcast) => {
      updater1(fromId, bytes, isBroadcast)
    }, 0, 720, bobWorker, true)

    try {
      setGenerateKeysState("Генерация началась");
      const start = Date.now();
      const results = await Promise.all([promise1, promise2])
      const end = Date.now();

      setGenerateKeysState(
        "Генерация завершена, потрачено " + (end - start) / 1000 + "с."
      );

      const key1 = results[0]
      const key2 = results[1]

      setKeys1(key1)
      setKeys2(key2)

      localStorage.setItem("saveData1", key1)
      localStorage.setItem("saveData2", key2)

      bobWorker.stop()
    } catch (e) {
      if (e instanceof ParametersException) {
        setGenerateKeysState("в функцию переданы неверные параметры");
        return;
      }

      if (e instanceof TimeoutExceedException) {
        setGenerateKeysState("таймер операции закончился");
        return;
      }

      setGenerateKeysState("неизвестная ошибка: " + (e as Error).message);
    }
  }, [preParams1, preParams2]);

  const handleSignMessage = useCallback(async () => {
    if (!keys1 || !keys2) {
      alert("Сначала сгенерируйте ключи пользователей");
      return;
    }

    // Список участников.
    const participants = [
      {
        id: "alice",
        moniker: "Alice",
        uniqueKey: "1",
      },
      { id: "bob", moniker: "Bob", uniqueKey: "2" },
    ]

    // Сообщение для подписи.
    const message = new Uint8Array([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, // "Hello"
      0x20,
      0x54, 0x53, 0x53           // "TSS"
    ])
    

    // Подпись сообщения для текущего пользователя
    const [updater1, promise1] = tssContext.signMessage("alice", participants, message, keys1, (fromId, toIdList, bytes, isBroadcast) => {
      updater2(fromId, bytes, isBroadcast)
    }, 0, 720)

    // Костыль для подписи сообщения для второго пользователя (симуляция другой машины).
    const bobWorker = new TssWorker()
    const bobMessageHandler = (payload: any) => {
    }
    const bobErrorHandler = (err: string) => {
      console.log("bob worker error", err)
    }
    bobWorker.init(bobMessageHandler, bobErrorHandler)

    // Дадим время на инициализацию воркера.
    await new Promise(r => setTimeout(r, 1000))
    // Подпись сообщения для другого пользователя (эмуляция другой машины)
    const [updater2, promise2] = tssContext.signMessage("bob", participants, message, keys2, (fromId, toIdList, bytes, isBroadcast) => {
      updater1(fromId, bytes, isBroadcast)
    }, 0, 720, bobWorker, true)

    try {
      setSignMessageState("Подпись началась");
      const start = Date.now();
      const results = await Promise.all([promise1, promise2])
      const end = Date.now();

      setSignMessageState(
        "Подпись завершена, потрачено " + (end - start) / 1000 + "с."
      );

      bobWorker.stop()

      const sign = results[0]
      setSign(JSON.stringify(sign))
      console.log("Получена подпись: ", sign)
    } catch (e) {
      if (e instanceof ParametersException) {
        setSignMessageState("в функцию переданы неверные параметры");
        return;
      }

      if (e instanceof TimeoutExceedException) {
        setSignMessageState("таймер операции закончился");
        return;
      }

      setSignMessageState("неизвестная ошибка: " + (e as Error).message);
    }
  }, [keys1, keys2])

  return (
    <main className={classes.main}>
      <div className={classes.container}>
        Статус: {stateToString(tssContext.state)}
      </div>
      {tssContext.errorDescription && (
        <div className={classes.container}>
          Ошибка: {tssContext.errorDescription}
        </div>
      )}
      <button className={classes.button} onClick={tssContext.initialize}>
        Перезапустить воркер
      </button>
      <div className={classes.container}>
        <span>1) Генерация предварительных параметров</span>
        Первый шаг при работе с библиотекой - сгенерировать PreParams. Это CPU
        bound задача, которая занимает продолжительное (6-8 минут) время.
        <br />
        Для каждого участника требуется свой набор PreParams. В демо примере их
        2, соответственно необходимо сгенерировать два набора PreParams.
        Значения сохранятся в localStorage, поэтому их можно будет
        переиспользовать после перезагрузки страницы (для ускорения
        тестирования).
        <button
          disabled={tssContext.state != TssState.IDLE}
          className={classes.button}
          onClick={handleGeneratePreParams1}
        >
          Запустить генерацию PreParams для первого участника
        </button>
        <span>{preParamsState1}</span>
        <button
          disabled={tssContext.state != TssState.IDLE}
          className={classes.button}
          onClick={handleGeneratePreParams2}
        >
          Запустить генерацию PreParams для второго участника
        </button>
        <span>{preParamsState2}</span>
      </div>
      <div className={classes.container}>
        <span>2) Генерация ключей</span>
        Второй шаг при работе с библиотекой - сгенерировать ключи для каждого пользователя. В обычной ситуации алгоритм запускается на машине каждого из пользователей, общение происходит по p2p протоколу. В данном тесте для простоты в качестве другой машины используется второй воркер. На моей машине занимает к сожалению 11 минут на двоих пользователей.
        <button
          disabled={tssContext.state != TssState.IDLE}
          className={classes.button}
          onClick={handleGenerateKeys}
        >
          Запустить генерацию ключей
        </button>
        <div>{generateKeysState}</div>
      </div>
      <div className={classes.container}>
        <span>3) Подпись сообщения</span>
        Третий и последний шаг - подписать сообщение. В качестве сообщения используется Uint8Array массив байтов - хэш от сообщения. Алгоритм работы аналогичен круговой генерации ключа, пользователи обмениваются между собой сообщениями по p2p протоколу. В данном тесте используется второй воркер в качестве второй машины.
      </div>
      <button disabled={tssContext.state != TssState.IDLE} className={classes.button} onClick={handleSignMessage}>
        Запустить подписание сообщения
      </button>
      <div>{ signMessageState }</div>
      { sign && <div>Ваша подпись: {sign}</div>}
    </main>
  );
}

function stateToString(state: TssState): string {
  switch (state) {
    case TssState.INIT:
      return "Инициализация";
    case TssState.GENERATE_KEYS:
      return "Генерация ключей";
    case TssState.SIGN_MESSAGE:
      return "Подписывается сообщение"
    case TssState.GENERATE_PRE_PARAMS:
      return "Генерация предварительных параметров";
    case TssState.IDLE:
      return "Ожидание команд";
    case TssState.WORKER_ERROR:
      return "Ошибка воркера";
  }
}
