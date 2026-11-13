# unison-sources

Плагины-источники книг для [Unison](https://github.com/NotoBoto/unison): один JS-файл на источник, одинаково работающий в приложении Android, в Unison Studio и в тестах. Дизайн — `SOURCES_DESIGN.md` в репозитории Unison (§4–§7, §19).

Встроенный репозиторий приложения: `https://notoboto.github.io/unison-sources/` (Викитека). Дополнительные источники (RanobeLib, Author.Today) — в [unison-sources-extra](https://github.com/NotoBoto/unison-sources-extra).

Контент сайтов принадлежит правообладателям. Плагины предназначены только для личного использования.

## Устройство

| Путь | Что это |
|---|---|
| `lib/types.ts` | контракт плагина `api: 1` (§5, §19) |
| `lib/runtime.ts` | сторона плагина в мосте с хостом (§19.1): `fetch`, `storage`, `log`, `definePlugin` |
| `lib/core/` | общий код каждого плагина: разбор HTML в абзацы, нормализация текста, URL, `crypto` на чистом JS, хэш главы. `CORE_VERSION` поднимается при любом изменении, которое меняет абзацы |
| `plugins/<id>/` | плагин: `index.ts`, `manifest.json`, `icon.png` |
| `scripts/build.mjs` | сборка в `site/`: `dist/<id>.js` (IIFE, es2020, без модулей), `icons/`, `index.json`, `index.json.sig` |
| `scripts/sign.mjs` | подпись ed25519: `keygen`, `verify` |
| `scripts/record.mjs` | запись golden-случая с живого сайта (честный UA, `rateLimit` плагина) |
| `scripts/smoke.mjs` | ночная проверка на живых сайтах |
| `tests/` | юнит-тесты `core`, golden-тесты и хосты для них (Node, Python, Android) |

Движок везде один: **quickjs-ng 0.12.1** (`engine: "qjs-ng-0.12.1"` в индексе). Правила для кода плагинов: никаких `Intl`, `toLocale*`, `localeCompare`, `Date.parse` нестандартных строк, `\b` рядом с кириллицей (в JS он только для ASCII), ES-модулей и `import()` в рантайме.

## Команды

```bash
npm ci
npm run typecheck
node tests/unit.mjs                 # core: quickjs-ng и V8, сверка crypto с node:crypto
node tests/golden.mjs               # golden: quickjs-ng (wasm) и V8, побайтно с tests/expected
node tests/golden.mjs --python <python с quickjs-ng==0.12.1.1>
node tests/golden.mjs --android <adb serial> --ndk <NDK> --qjs-src <исходники quickjs-ng v0.12.1>
node tests/golden.mjs --update      # переписать эталоны (после проверки глазами!)
node scripts/build.mjs              # site/ для GitHub Pages; с UNISON_SIGNING_KEY ещё и подпись
node scripts/smoke.mjs              # живые сайты
```

Новый golden-случай:

```bash
node scripts/build.mjs
node scripts/record.mjs wikisource-ru <имя> '[{"fn":"details","args":["Хамелеон (Чехов)"]}]'
node tests/golden.mjs --update && git diff tests/expected
```

## CI (`.github/workflows/`)

- `ci.yml` — на каждый коммит: типы, юнит-тесты, golden на quickjs-ng, V8 и Python.
- `publish.yml` — на `main`: сборка, подпись секретом `UNISON_SIGNING_KEY`, публикация `site/` на GitHub Pages.
- `smoke.yml` — каждую ночь живые сайты; при поломке открывает issue.
- `engine.yml` — раз в неделю и вручную: golden в эмуляторе Android на голом quickjs-ng.

## Ключ подписи

```bash
node scripts/sign.mjs keygen
```

Публичный ключ зашивается в приложение и Studio (текущий и запасной). Закрытый — в секрет `UNISON_SIGNING_KEY` репозитория и в офлайн-копию у владельца. В git его не кладём.
