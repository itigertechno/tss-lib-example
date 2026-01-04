import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { Participant } from "./participant";
import {
  globalWorker,
  TssWorker,
  WorkerError,
} from "./worker";
import { ParametersException, TimeoutExceedException } from "./errors";

export enum TssState {
  /** WASM модуль и подключение к воркеру инициализируются. */
  INIT,
  /** Генерируются предварительные параметры. */
  GENERATE_PRE_PARAMS,
  /** Генерируются ключи. */
  GENERATE_KEYS,
  /** Подписывается сообщение. */
  SIGN_MESSAGE,
  /** Бездействие. */
  IDLE,
  /** Ошибка воркера. */
  WORKER_ERROR,
}

export interface Signature {
  /** Base64 r+s */
  signature: string
  signature_recovery: string
  /** Base64 r */
  r: string
  /** Base64 s */
  s: string
  /** Base64 кодируемое сообщение. */
  m: string
}

interface ITssContext {
  /** Состояние оболочки. */
  state: TssState;

  /** Описание возможной ошибки в воркере. */
  errorDescription: string;

  /** Позволяет заново инициализировать воркер в случае ошибки. */
  initialize: () => void;

  /**
   * Запускает процесс генерации предварительных параметров в воркере.
   *
   * Воркер может обрабатывать одновременное только одну операцию.
   *
   * Обратите внимание, что это cpu-bound задача, выполняется порядка 6-7 минут на macbook air m1.
   *
   * @param timeoutS Таймаут в секундах, после которого выбрасывается исключение об истекшем времени.
   * @param curveType Тип кривой, которая используется в вычислениях. 0 - secp256k1, 1 - edwards.
   *
   * @throws {TimeoutExceedException} Таймер операции закончился.
   * @throws {ParametersException} Переданы неверные параметры.
   * 
   * @returns JSON строку с preParams. Внимание, не делайте JSON.parse, потому что JS переведет большие числа из этой строки в Infinity.
   */
  generatePreParams: (timeoutS: number, curveType: 0 | 1) => Promise<string>;

  /**
   * Запускает интерактивный процесс генерации ключа для пользователя.
   *
   * Обратите внимание, что воркер может обрабатывать одновременно только одну операцию.
   *
   * @throws {TimeoutExceedException} Таймер операции закончился.
   * @throws {ParametersException} Переданы неверные параметры.
   * 
   * @returns Кортеж из функции-updater, которая должна вызываться всякий раз, когда по сети приходит новое сообщение и нужно доставить его до текущего пира, а также промиса, который вернет json строку с данными ключа.
   */
  generateKeys: (
    /** Уникальный ID текущего пира. */
    id: string,
    /** Список всех участников в произвольном порядке. */
    participants: Array<Participant>,
    /** Заранее сгенерированная строка с preParams пира. */
    preParams: string,
    /** Функция, которая выполнится при получении нового сообщения от текущего пира. Это сообщение должно быть отправлено другим участникам по p2p соединению и доставлено при помощи updater функции. */
    messageCallback: (fromId: string, toIdList: Array<string>, bytes: Uint8Array, isBroadcast: boolean) => void,
    /** Тип кривой, которая будет использоваться при генерации ключа. 0 - secp256k1, 1 - Edwards. */
    curveType: 0 | 1,
    /** Таймаут в секундах, после которого операция принудительно закончится. */
    timeoutS: number,
    /** Инстанс воркера, который нужно использовать. По умолчанию использует {@linkcode globalWorker}. */
    useWorker?: TssWorker,
    skipCheck?: boolean
  ) => readonly [(fromId: string, bytes: Uint8Array, isBroadcast: boolean) => void, Promise<string>];

  /** 
   * Запускает интерактивный процесс подписания сообщения.
   * 
   * Обратите внимание, что воркер может обрабатывать одновременно только одну операцию.
   * 
   * @throws {TimeoutExceedException} Таймер операции закончился.
   * @throws {ParametersException} Переданы неверные параметры.
   * 
   * @returns Кортеж из функции-updater, которая должна вызываться всякий раз, когда по сети приходит новое сообщение и нужно доставить его до текущего пира, а также промиса, который вернет json строку c подписью.
   */
  signMessage: (
    /** Уникальный ID текущего пира. */
    id: string,
    /** Список всех участников в произвольном порядке. */
    participants: Array<Participant>,
    /** Подпись сообщения. */
    messageBytes: Uint8Array,
    /** Строка с saveData (ключом пользователя), которая получена в результате {@linkcode generateKeys}. */
    saveData: string,
    /** Функция, которая выполнится при получении нового сообщения от текущего пира. Это сообщение должно быть отправлено другим участникам по p2p соединению и доставлено при помощи updater функции. */
    messageCallback: (fromId: string, toIdList: Array<string>, bytes: Uint8Array, isBroadcast: boolean) => void,
    /** Тип кривой, которая будет использована. 0 - secp256k1, 1 - Edwards. */
    curveType: 0 | 1,
    /** Таймаут в секундах, после которого операция принудительно закончится. */
    timeoutS: number,
    /** Инстанс воркера, который нужно использовать. По умолчанию использует {@linkcode globalWorker}. */
    customWorker?: TssWorker,
    skipCheck?: boolean
  ) => readonly [(fromId: string, bytes: Uint8Array, isBroadcast: boolean) => void, Promise<Signature>];
}

const TssContext = createContext<ITssContext>({} as ITssContext);

/** Возвращает контекст для использования wasm порта библиотеки tss-lib. */
export function useTssContext(): ITssContext {
  return useContext(TssContext) as ITssContext;
}

interface ITssContextProviderProps {
  children: React.ReactNode;
}

/** Провайдер для контекста библиотеки tss-lib. */
export function TssContextProvider(props: ITssContextProviderProps) {
  /** Состояние оболочки. */
  const [state, setState] = useState<TssState>(TssState.INIT);
  let stateRef = useRef<TssState>(TssState.INIT);
  /** Описание возможной ошибки воркера. */
  const [errorDescription, setErrorDescription] = useState<string>("");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** Обработчик сообщений от воркера. */
  const handleMessage = useCallback((data: any) => {
    const type = data.type;
    if (!type) {
      console.error("неизвестное сообщение от воркера", data);
      return;
    }
  }, []);

  /** Обработчик ошибок от воркера. */
  const handleError = useCallback(
    (description: string) => {
      setState(TssState.WORKER_ERROR);
      setErrorDescription(description);
    },
    [state]
  );

  /** Инициализирует воркер и обрабатывает результаты инициализации. */
  const handleInitWorker = useCallback(async () => {
    setState(TssState.INIT);
    setErrorDescription("");

    /** Возможно, пользователь снова вызывает инициализацию воркера, поэтому можно безопасно остановить воркер перед перезапуском. */
    globalWorker.stop()
    const result = await globalWorker.init(handleMessage, handleError);

    if (result[0]) {
      setState(TssState.IDLE);
    } else {
      setState(TssState.WORKER_ERROR);

      switch (result[1]) {
        case WorkerError.NOTHING:
          break;
        case WorkerError.CANNOT_CREATE_WORKER:
          setErrorDescription("не удалось создать воркер");
          break;
      }
    }
  }, []);

  /** После загрузки страницы запускаем инициализацию воркера. */
  useEffect(() => {
    handleInitWorker();
  }, []);

  /** Обработчик функции генерации предварительных параметров. */
  const handleGeneratePreParams = useCallback(
    async (timeoutS: number, curveType: 0 | 1) => {
      if (stateRef.current != TssState.IDLE) {
        return "";
      }

      setState(TssState.GENERATE_PRE_PARAMS);
      globalWorker.sendMessage("generatePreParams", { timeout: timeoutS, curveType });

      return await new Promise<string>((resolve, reject) => {
        const unsubscribe = globalWorker.subscribeToMessage("generatedPreparamsResult", (result) => {
          setState(TssState.IDLE);
          unsubscribe()

          /** Неверные параметры */
          if (result == 0) {
            reject(new ParametersException());
            return;
          }

          /** Ошибка таймаута. */
          if (result == 1) {
            reject(new TimeoutExceedException());
            return;
          }

          resolve(result);
        })
      });
    },
    [state]
  );

  /** Обработчик функции запуска генерации ключей. */
  const handleGenerateKeys = (
    id: string, 
    participants: Array<Participant>, 
    preParams: string, 
    messageCallback: (fromId: string, toIdList: Array<string>, bytes: Uint8Array, isBroadcast: boolean) => void,
    curveType: 0 | 1,
    timeoutS: number,
    customWorker = globalWorker,
    skipCheck = false
  ) => {
    if (stateRef.current != TssState.IDLE && !skipCheck) {
      throw new ParametersException()
    }

    setState(TssState.GENERATE_KEYS);
    customWorker.sendMessage("generateKeys", {
      id,
      participants: JSON.stringify(participants),
      preParams,
      curveType,
      timeout: timeoutS,
    });

    /** Привязываем к воркеру новый обработчик сообщения, который потом удалим. */
    const unsubscribeNewMessage = customWorker.subscribeToMessage("generateKeysNewMessage", (payload: any) => {
      console.log("new generateKeysNewMessage message from worker", payload)

      const fromId = payload?.fromId as string
      const toIdList = payload?.toIdList as Array<string>
      const bytes = payload?.bytes as Uint8Array
      const isBroadcast = payload?.isBroadcast as boolean

      if (toIdList && bytes) {
        messageCallback(fromId, toIdList, bytes, isBroadcast)
      }
    })

    /** Функция-updater для новых данных, которые пришли по p2p сети и которые нужно доставить в GO. */
    const updater = (fromId: string, bytes: Uint8Array, isBroadcast: boolean) => {
      customWorker.sendMessage("generateKeysUpdateBytes", { fromId, bytes, isBroadcast })
    }

    const waitPromise = new Promise<string>((resolve, reject) => {
      const unsubscribe = customWorker.subscribeToMessage("generatedKeysResult", (result) => {
        setState(TssState.IDLE);
        unsubscribe()
        unsubscribeNewMessage()

        /** Неверные параметры */
        if (result == 0) {
          reject(new ParametersException());
          return;
        }

        /** Ошибка таймаута. */
        if (result == 1) {
          reject(new TimeoutExceedException());
          return;
        }

        resolve(result);
      })  
    }) as Promise<string>

    return [updater, waitPromise] as const
  }

  /** Обработчик функции запуска подписи сообщения. */
  const handleSignMessage = (
    id: string,
    participants: Array<Participant>,
    messageBytes: Uint8Array,
    saveData: string,
    messageCallback: (fromId: string, toIdList: Array<string>, bytes: Uint8Array, isBroadcast: boolean) => void,
    curveType: 0 | 1,
    timeoutS: number,
    customWorker = globalWorker,
    skipCheck = false
  ) => {
    if (stateRef.current != TssState.IDLE && !skipCheck) {
      throw new ParametersException()
    }

    setState(TssState.SIGN_MESSAGE);
    customWorker.sendMessage("signMessage", {
      id,
      participants: JSON.stringify(participants),
      message: messageBytes,
      saveData,
      curveType,
      timeout: timeoutS
    });

    /** Привязываем к воркеру новый обработчик сообщения, который потом удалим. */
    const unsubscribeNewMessage = customWorker.subscribeToMessage("signMessageNewMessage", (payload: any) => {
      console.log("new signMessageNewMessage message from worker", payload)

      const fromId = payload?.fromId as string
      const toIdList = payload?.toIdList as Array<string>
      const bytes = payload?.bytes as Uint8Array
      const isBroadcast = payload?.isBroadcast as boolean

      if (toIdList && bytes) {
        messageCallback(fromId, toIdList, bytes, isBroadcast)
      }
    })

    /** Функция-updater для новых данных, которые пришли по p2p сети и которые нужно доставить в GO. */
    const updater = (fromId: string, bytes: Uint8Array, isBroadcast: boolean) => {
      customWorker.sendMessage("signMessageUpdateBytes", { fromId, bytes, isBroadcast })
    }

    const waitPromise = new Promise<Signature>((resolve, reject) => {
      const unsubscribe = customWorker.subscribeToMessage("signMessageResult", (result) => {
        setState(TssState.IDLE);
        unsubscribe()
        unsubscribeNewMessage()

        /** Неверные параметры */
        if (result == 0) {
          reject(new ParametersException());
          return;
        }

        /** Ошибка таймаута. */
        if (result == 1) {
          reject(new TimeoutExceedException());
          return;
        }

        resolve(JSON.parse(result)["signature"]);
      })  
    }) as Promise<Signature>

    return [updater, waitPromise] as const
  }

  return (
    <TssContext.Provider
      value={{
        state,
        errorDescription,
        initialize: handleInitWorker,
        generatePreParams: handleGeneratePreParams,
        generateKeys: handleGenerateKeys,
        signMessage: handleSignMessage
      }}
    >
      {props.children}
    </TssContext.Provider>
  );
}
