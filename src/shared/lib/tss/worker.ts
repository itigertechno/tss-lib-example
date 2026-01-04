// Файл для взаимодействия с воркером.

export enum WorkerError {
  NOTHING,
  CANNOT_CREATE_WORKER,
}

export class TssWorker {

  instance!: Worker

  /**
   * Инициализирует воркер. Должна быть вызвана сразу при загрузке страницы.
   *
   * При любой ошибке в воркере сбрасывает подключение, необходимо повторно вызвать {@linkcode initWorker}.
   *
   * @param messageHandler Обработчик, который будет привязан ко всем приходящим от воркера сообщениям.
   * @param errorHandler Обработчик, который будет привязан ко всем ошибкам воркера.
   *
   * @returns Кортеж с флагом, который показывает, успешно ли прошло соединение, а также кодом ошибки, если она произошал.
   */
  async init(
    messageHandler: (payload: any) => void,
    errorHandler: (description: string) => void
  ) {
    this.instance = new Worker("/wasm-worker.js");

    if (! this.instance) {
      return [false, WorkerError.CANNOT_CREATE_WORKER];
    }
  
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
  
      if (data?.type == "error") {
        errorHandler(data?.payload as string);
        this.stop();
        return;
      }
  
      messageHandler(ev.data);
    };
    const onError = (ev: ErrorEvent) => {
      errorHandler(ev.error.message);
      this.stop();
    };
  
    this.instance.addEventListener("message", onMessage);
    this.instance.addEventListener("error", onError);
  
    // Отправляем команду инициализации.
    this.instance.postMessage({ type: "init" });

    return await new Promise(resolve => {
      const unsubscribe = this.subscribeToMessage("initDone", () => {
        unsubscribe()
        resolve([true, WorkerError.NOTHING])
      })
    }) as [boolean, WorkerError]
  }

  stop() {
    if (!this.instance) return

    this.instance.terminate()
  }

  sendMessage(type: string, payload: any) {
    if (!this.instance) return

    this.instance.postMessage({type, payload})
  }

  subscribeToMessage(type: string, callback: (payload: any) => void): () => void {
    if (!this.instance) return () => {}

    const handler = (ev: MessageEvent) => {
      const data = ev.data
      if (data?.type == type) {
        callback(data.payload)
      }
    }
  
    this.instance.addEventListener("message", handler)
  
    return () => {
      this.instance.removeEventListener("message", handler)
    }
  }

}

export const globalWorker = new TssWorker()