export class TimeoutExceedException extends Error {
  constructor() {
    super("таймер операции истек");
  }
}

export class ParametersException extends Error {
  constructor() {
    super("неверные параметры функции");
  }
}
