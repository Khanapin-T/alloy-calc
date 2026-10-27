# Alloy calculator

Калькулятор сплава для ювелирной мастерской: расчёт шихты на опоку, доведение пробы, проверка смеси.
Статический сайт без сборки, ставится как приложение (PWA) и работает без интернета.

Сайт: https://khanapin-t.github.io/alloy-calc/

## Установка как приложение

- **Windows**: Chrome или Edge → значок «Установить» в адресной строке (или меню ⋮ → Install).
- **Android**: Chrome → меню ⋮ → Install app.
- **iPhone**: Safari → Share → Add to Home Screen.

Данные (история, введённые значения) хранятся только на устройстве.

## Разработка

```
node --test
```

Файлы: `index.html` (интерфейс), `solver.js` (расчёты, без DOM), `solver.test.js` (тесты),
`sw.js` (офлайн), `manifest.json` и иконки (установка).

Эскизы нового интерфейса: `design/index.html` (5 вариантов экрана «Расчёт», живые, на `solver.js`).
Запуск: `python -m http.server 8080` в корне репозитория, затем http://localhost:8080/design/
