# Фронтенд с wasm-библиотекой TSS.

Стандартный сетап NextJs. \
Код js части оболочки находится в `src/shared/lib/tss`. \
Пример использования находится в `src/app/tss-test.tsx`. \
Можно запустить приложение и проверить весь функционал.

Golang код wasm оболочки находится в `vendor/go`. \
Собрать оболочку можно, перейдя в vendor/go и выполнив `./build.sh`. \
Собранный файл находится в `public`.

Для использования в wasm оригинальная библиотека [https://gitlab.com/thorchain/tss/tss-lib](https://gitlab.com/thorchain/tss/tss-lib) не подходит в силу однопоточной природы wasm и работы библиотеки с cpu-bound задачами, которые блокировали многопоточный код. \
Репозиторий с форком tss-lib для использования в wasm - https://github.com/itigertechno/tss-lib-wasm-fork

## Запуск проекта
 - `docker build -t tss-next .`
 - `docker run -p 3000:3000 --name tss-next --rm tss-next`
 - [http://localhost:3000](http://localhost:3000)

Дев режим:
 - `docker build -t tss-next-dev -f Dockerfile.dev .`
 - `docker run -p 3000:3000 --name tss-next-dev --rm tss-next-dev`
 - [http://localhost:3000](http://localhost:3000)