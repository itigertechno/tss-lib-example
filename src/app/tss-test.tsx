"use client";

import classes from "./tss-test.module.css";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ParametersException,
  Signature,
  TimeoutExceedException,
  TssState,
  TssWorker,
  useTssContext,
} from "@/shared/lib/tss";

type TssPeerData = {
  id: string
  moniker: string
  uniqueKey: string
  preParams: string | null
  keys: string | null
}

export default function TestTSS() {
  const tssContext = useTssContext()

  // const handleSignMessage = useCallback(async () => {
  //   if (!keys1 || !keys2) {
  //     alert("Сначала сгенерируйте ключи пользователей");
  //     return;
  //   }

  //   // Список участников.
  //   const participants = [
  //     {
  //       id: "alice",
  //       moniker: "Alice",
  //       uniqueKey: "1",
  //     },
  //     { id: "bob", moniker: "Bob", uniqueKey: "2" },
  //   ]

  //   // Сообщение для подписи.
  //   const message = new Uint8Array([
  //     0x48, 0x65, 0x6c, 0x6c, 0x6f, // "Hello"
  //     0x20,
  //     0x54, 0x53, 0x53           // "TSS"
  //   ])
    
  //   // Костыль для подписи сообщения для второго пользователя (симуляция другой машины).
  //   const bobWorker = new TssWorker()
  //   const bobMessageHandler = (payload: any) => {
  //   }
  //   const bobErrorHandler = (err: string) => {
  //     console.log("bob worker error", err)
  //   }
  //   await bobWorker.init(bobMessageHandler, bobErrorHandler)

  //   // Подпись сообщения для текущего пользователя
  //   const [updater1, promise1] = tssContext.signMessage("alice", participants, message, keys1, (fromId, toIdList, bytes, isBroadcast) => {
  //     updater2(fromId, bytes, isBroadcast)
  //   }, 0, 720)

  //   // Подпись сообщения для другого пользователя (эмуляция другой машины)
  //   const [updater2, promise2] = tssContext.signMessage("bob", participants, message, keys2, (fromId, toIdList, bytes, isBroadcast) => {
  //     updater1(fromId, bytes, isBroadcast)
  //   }, 0, 720, bobWorker, true)

  //   try {
  //     setSignMessageState("Подпись началась");
  //     const start = Date.now();
  //     const results = await Promise.all([promise1, promise2])
  //     const end = Date.now();

  //     setSignMessageState(
  //       "Подпись завершена, потрачено " + (end - start) / 1000 + "с."
  //     );

  //     bobWorker.stop()

  //     const sign = results[0]
  //     setSign(JSON.stringify(sign))
  //     console.log("Получена подпись: ", sign)
  //   } catch (e) {
  //     if (e instanceof ParametersException) {
  //       setSignMessageState("в функцию переданы неверные параметры");
  //       return;
  //     }

  //     if (e instanceof TimeoutExceedException) {
  //       setSignMessageState("таймер операции закончился");
  //       return;
  //     }

  //     setSignMessageState("неизвестная ошибка: " + (e as Error).message);
  //   }
  // }, [keys1, keys2])

  const [data, setData] = useState<Array<TssPeerData>>([
    {
      id: "alice",
      moniker: "Alice",
      uniqueKey: "1",
      preParams: null,
      keys: null
    },
    {
      id: "bob",
      moniker: "Bob",
      uniqueKey: "2",
      preParams: null,
      keys: null
    },
    {
      id: "charlie",
      moniker: "Charlie",
      uniqueKey: "3",
      preParams: null,
      keys: null
    }
  ])

  const handleSetKey = (id: string, key: string) => {
    setData(old => old.map(item => {
      if (item.id === id) {
        return {...item, keys: key }
      }
      return item
    }))
  }

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
      <div className={classes.delimiter} />
      {
        data.map((peerData, idx) => {
          const setPreParams = (preParams: string) => {
            setData(old => old.map((item, i) => {
              if (i == idx) {
                return { ...item, preParams }
              }
              return item
            }))
          }

          return <PreParams key={idx} id={peerData.id} moniker={peerData.moniker} uniqueKey={peerData.uniqueKey} setPreParams={setPreParams} />
        })
      }
      <div className={classes.delimiter} />
      <Keys participants={data.map(d => ({id: d.id, moniker: d.moniker, uniqueKey: d.uniqueKey, preParams: d.preParams}))} setKey={handleSetKey} />
      <div className={classes.delimiter} />
      <Sign participants={data.map(d => ({id: d.id, moniker: d.moniker, uniqueKey: d.uniqueKey, keys: d.keys}))} />
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

interface IPreParamsProps {
  id: string
  moniker: string
  uniqueKey: string
  setPreParams: (preParams: string) => void
}

/** Компонент для генерации preParams для пира. Инкапсулирует логику сохранения сгенерированных preParams. */
function PreParams(props: IPreParamsProps) {
  const [message, setMessage] = useState("")
  const [timeout, setTimeout] = useState(700)

  const tssContext = useTssContext()

  const localStorageKey = `${props.moniker}-preParams`

  useEffect(() => {
    const storedPreParams = localStorage.getItem(localStorageKey)

    if (storedPreParams) {
      setMessage("Есть сохраненные preParams в localStorage, можно пропустить генерацию")
      props.setPreParams(storedPreParams)
    }
  }, [])

  const handleGeneratePreParams = useCallback(async () => {
    try {
      setMessage(`Запущена генерация preParams для пира ${props.moniker}...`)
      
      const start = performance.now()
      const result = await tssContext.generatePreParams(timeout, 0)
      const end = performance.now()

      const took = ((end - start) / 1000)

      setMessage(`Генерация preParams завершена, заняло ${took} секунд.`)

      localStorage.setItem(localStorageKey, result)

      props.setPreParams(result)
    } catch (e) {
      if (e instanceof TimeoutExceedException) {
        setMessage("Таймер операции закончился")
      } else if (e instanceof ParametersException) {
        setMessage("В функцию переданы неверные параметры")
      } else {
        setMessage("Неизвестная ошибка: " + (e as Error).message)
      }
    }
  }, [])

  return <div className={classes.container}>
    <span>PreParams для пира {props.moniker}</span>
    <span>Timeout: <input className={classes.timeoutInput} type="number" value={timeout} onChange={(ev) => setTimeout(+ev.target.value)} /> s.</span>
    <input type="range" min={10} max={1000} step={1} value={timeout} onChange={(ev) => setTimeout(+ev.target.valueAsNumber)} />
    <button disabled={tssContext.state !== TssState.IDLE} onClick={handleGeneratePreParams} className={classes.button}>
      Запустить генерацию preParams
    </button>
    <span>{ message }</span>
  </div>
}

interface IKeysProps {
  participants: Array<{
    id: string,
    moniker: string,
    uniqueKey: string
    preParams: string | null
  }>
  setKey: (id: string, key: string) => void
}

/** Компонент для интерактивной генерации ключей для переданных участников. */
function Keys(props: IKeysProps) {
  const [isActive, setIsActive] = useState(false)
  const [message, setMessage] = useState("")
  const [timeout, setTimeout] = useState(700)

  const participantsRef = useRef(props.participants)
  useEffect(() => {
    participantsRef.current = props.participants
  }, [props.participants])

  const tssContext = useTssContext()

  const handleStartGenerateKeys = async () => {
    const p = participantsRef.current

    if (p.length < 2) {
      throw new Error("слишком мало участников")
    }

    const workers = new Array<TssWorker>()

    try {
      setMessage("Инициализируем воркеры...")
      setIsActive(true)

      const start = performance.now()

      // Инициализируем задачи для всех участников.
      const updaterMap = new Map<string, (fromId: string, bytes: Uint8Array, isBroadcast: boolean) => void>()
      const promises = new Array<Promise<string>>()
      for (const participant of p) {
        if (!participant.preParams) {
          throw Error("Сначала сгенерируйте preParams для пира " + participant.moniker)
        }
        const worker = new TssWorker()
        
        await worker.init(() => {}, () => {})

        workers.push(worker)
  
        const [updater, promise] = tssContext.generateKeys(
          participant.id,
          p.map(item => ({id: item.id, moniker: item.moniker, uniqueKey: item.uniqueKey})),
          participant.preParams, 
          (fromId, toIds, bytes, isBroadcast) => {
            if (isBroadcast) {
              for (const updater of updaterMap.values()) {
                updater(fromId, bytes, isBroadcast)
              }
            } else {
              for (const id of toIds) {
                const updater = updaterMap.get(id)
                if (!updater) {
                  console.error("cannot found updater for id", id)
                  return
                }
                updater(fromId, bytes, isBroadcast)
              }
            }
          }, 
          0, 
          timeout, 
          worker, 
          true
        )
  
        updaterMap.set(participant.id, updater)
        promises.push(promise)
      }

      setMessage("Запускаем генерацию ключей...")
  
      const result = await Promise.all(promises)

      const end = performance.now()
      const took = (end - start) / 1000

      let message = `Генерация ключей окончена, заняло ${took} секунд`
     
      for (const idx in result) {
        const r = result[idx]
        const moniker = p[idx].moniker
        message += "<br /><br />" + moniker + ": " + r
        props.setKey(p[idx].id, r)
      }

      setMessage(message)
    } catch (e) {
      if (e instanceof TimeoutExceedException) {
        setMessage("Таймер операции закончился")
      } else if (e instanceof ParametersException) {
        setMessage("В функцию переданы неверные параметры")
      } else {
        setMessage("Неизвестная ошибка: " + (e as Error).message)
      }
    } finally {
      setIsActive(false)
      for (const worker of workers) {
        worker.stop()
      }
    }
  }

  return <div className={classes.container}>
    <span>
      Генерация ключей для пиров {props.participants.map(p => p.moniker).join(", ")}
    </span>
    <span>Timeout: <input className={classes.timeoutInput} type="number" value={timeout} onChange={(ev) => setTimeout(+ev.target.value)} /> s.</span>
    <input type="range" min={10} max={1000} step={1} value={timeout} onChange={(ev) => setTimeout(+ev.target.valueAsNumber)} />
    <button onClick={handleStartGenerateKeys} className={classes.button} disabled={tssContext.state !== TssState.IDLE || isActive}>
      Запустить генерацию ключей
    </button>
    <span dangerouslySetInnerHTML={{__html: message}}></span>
  </div>
}

interface ISignProps {
  participants: Array<{
    id: string,
    moniker: string,
    uniqueKey: string
    keys: string | null
  }>
}

/** Компонент для интерактивной генерации подписи со всеми участниками. */
function Sign(props: ISignProps) {
  const [timeout, setTimeout] = useState(700)
  const [signMessage, setSignMessage] = useState("")
  const [message, setMessage] = useState("")
  const [isActive, setIsActive] = useState(false)

  const tssContext = useTssContext()

  const handleSignMessage = async () => {
    const encoder = new TextEncoder()
    const messageBytes = encoder.encode(signMessage)

    if (messageBytes.length == 0) {
      alert("Пустое сообщение для подписи")
      return
    }

    const p = props.participants
    
    if (p.length < 2) {
      alert("слишком мало участников")
      return
    }

    const workers = new Array<TssWorker>()

    try {
      setMessage("Инициализируем воркеры...")
      setIsActive(true)

      const start = performance.now()

      // Инициализируем задачи для всех участников.
      const updaterMap = new Map<string, (fromId: string, bytes: Uint8Array, isBroadcast: boolean) => void>()
      const promises = new Array<Promise<Signature>>()
      for (const participant of p) {
        if (!participant.keys) {
          throw Error("Сначала сгенерируйте ключи для пира " + participant.moniker)
        }
        const worker = new TssWorker()
        
        await worker.init(() => {}, () => {})

        workers.push(worker)
      }

      for (const idx in p) {
        const participant = p[idx]
        const worker = workers[idx]

        if (!participant.keys) {
          break
        }

        const [updater, promise] = tssContext.signMessage(
          participant.id,
          p.map(i => ({id: i.id, moniker: i.moniker, uniqueKey: i.uniqueKey})),
          messageBytes,
          participant.keys,
          (fromId, toIdList, bytes, isBroadcast) => {
            if (isBroadcast) {
              for (const updater of updaterMap.values()) {
                updater(fromId, bytes, isBroadcast)
              }
            } else {
              for (const id of toIdList) {
                const updater = updaterMap.get(id)
                if (!updater) {
                  console.warn("cannot found updater for id", id)
                  return
                }
                updater(fromId, bytes, isBroadcast)
              }
            }
          },
          0,
          timeout, 
          worker,
          true
        )
  
        updaterMap.set(participant.id, updater)
        promises.push(promise)
      }

      setMessage("Запускаем подпись сообщения...")
  
      const result = await Promise.all(promises)

      console.log("got result", result)

      const end = performance.now()
      const took = (end - start) / 1000

      const signature = result[0]
      const message = `Подпись окончена, заняло ${took} секунд<br/><br/> Signature: ${signature.signature} <br/><br/> r: ${signature.r} <br/><br/> s: ${signature.s}`

      setMessage(message)
    } catch (e) {
      if (e instanceof TimeoutExceedException) {
        setMessage("Таймер операции закончился")
      } else if (e instanceof ParametersException) {
        setMessage("В функцию переданы неверные параметры")
      } else {
        setMessage("Неизвестная ошибка: " + (e as Error).message)
      }
    } finally {
      setIsActive(false)
      for (const worker of workers) {
        worker.stop()
      }
    }
  }

  return <div className={classes.container}>
    <span>Подпись сообщения</span>
    <input className={classes.timeoutInput} placeholder="Ваше сообщение" value={signMessage} onChange={ev => setSignMessage(ev.target.value)} />
    <span>Timeout: <input className={classes.timeoutInput} type="number" value={timeout} onChange={(ev) => setTimeout(+ev.target.value)} /> s.</span>
    <input type="range" min={10} max={1000} step={1} value={timeout} onChange={(ev) => setTimeout(+ev.target.valueAsNumber)} />
    <button className={classes.button} onClick={handleSignMessage} disabled={tssContext.state !== TssState.IDLE || isActive}>
      Подписать сообщение
    </button>
    <span dangerouslySetInnerHTML={{__html: message}}></span>
  </div>
}

async function sleep(ms: number) {
  return await new Promise(resolve => setTimeout(resolve, ms))
}