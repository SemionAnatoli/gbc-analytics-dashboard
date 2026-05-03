# GBC Analytics Dashboard

Бизнес-дашборд для мониторинга заказов: RetailCRM -> Supabase -> Next.js/Vercel + Telegram-уведомления.

Проект подготовлен как публичное демо для работодателя: даже без приватных ключей CRM и Supabase он открывается на Vercel, показывает реалистичные данные из `mock_orders.json` и дает по-настоящему покликать рабочие сценарии.

## Что можно проверить в демо

- KPI по заказам, выручке, среднему чеку и крупным заказам.
- Фильтры по периоду, городу, статусу, UTM-источнику и поиску.
- Графики заказов/выручки, статусов, городов, источников и топ-товаров.
- Экспорт текущей выборки в CSV.
- Добавление демо-заказа без перезагрузки страницы.
- Изменение статуса заказа прямо в таблице или карточке заказа.
- Карточка заказа с товарами, суммой, источником и контактами.
- Симуляция Telegram-уведомления для заказов больше 50 000 KZT.
- Fallback-режим: если Supabase недоступен, интерфейс автоматически показывает демо-данные.

## Стек

| Зона | Технологии |
| --- | --- |
| Frontend | Next.js 14 App Router, React, TypeScript |
| UI | Tailwind CSS, Recharts |
| Data | Supabase/PostgreSQL, JSONB `items` |
| CRM | RetailCRM API v5 |
| Automation | Node.js scripts, Telegram Bot API |
| Deploy | Vercel |

## Структура

```text
app/
  page.tsx                 server wrapper: получает данные и отдает dashboard app
  layout.tsx
  globals.css
components/
  DashboardApp.tsx         интерактивный дашборд
  DashboardCharts.tsx      Recharts-графики
lib/
  analytics.ts             чистые функции агрегации
  data.ts                  Supabase + demo fallback
  supabase.ts              server-side Supabase client
  types.ts
scripts/
  upload-to-retailcrm.js   загрузка mock_orders.json в RetailCRM
  sync-to-supabase.js      синхронизация RetailCRM -> Supabase
  telegram-bot.js          уведомления о крупных заказах
supabase/
  schema.sql               таблица orders и индексы
mock_orders.json           демо-заказы для публичного просмотра
```

## Локальный запуск

```bash
npm install
cp .env.example .env
npm run dev
```

Открыть: `http://localhost:3000`

Для публичного демо оставьте:

```env
NEXT_PUBLIC_DEMO_MODE=true
```

Так проект не зависит от приватных сервисов и стабильно работает на Vercel.

## Деплой на Vercel

1. Импортировать репозиторий в Vercel.
2. Framework Preset: `Next.js`.
3. Build Command: `npm run build`.
4. Output Directory оставить пустым.
5. В Environment Variables добавить:

```env
NEXT_PUBLIC_DEMO_MODE=true
```

Live-интеграции можно подключить позже в приватном окружении:

```env
RETAILCRM_URL=...
RETAILCRM_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Live-пайплайн

```bash
cd scripts
npm install
npm run upload   # mock_orders.json -> RetailCRM
npm run sync     # RetailCRM -> Supabase
npm run bot      # Telegram alerts for high-value orders
```

`supabase/schema.sql` создает таблицу `orders`, индексы и RLS-политики. Дашборд читает данные server-side; запись выполняется через service role в скриптах.

## Проверка перед деплоем

```bash
npx tsc --noEmit
npm run build
```
