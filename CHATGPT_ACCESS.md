# Подключение личного ChatGPT

Семейный дневник использует ChatGPT как подключённого ИИ-провайдера. Роли членов семьи и доступ к медицинским карточкам определяет дневник. Успешный вход через OpenAI сам по себе даёт только идентификацию. Для отправки запросов нужна отдельная возможность **ChatGPT plan use for AI requests**. Справка OpenAI перечисляет Go, Plus, Pro и Business для участвующих коммерческих приложений с учётом условий конкретной интеграции. Руководство по открытому клиенту указывает подходящие аккаунты Plus и Pro. Тариф Free для размещённого дневника требует отдельного подтверждения. [Справка OpenAI](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) · [Руководство разработчика](https://developers.openai.com/siwc/quickstart)

## Заявка в OpenAI

Владелец сообщил, что отправил заявку. Ожидаем подтверждение для сайта и нативного приложения.

В [форме OpenAI](https://openai.com/form/sign-in-with-chatgpt-interest/) выбрать **Sign in and ChatGPT plan use for AI requests**. Адрес продукта — `https://saveli0s.github.io/health-story-web/`. Форма требует имя, фамилию, рабочий email и название организации. В описании нужно указать, что это частный семейный проект, и попросить подтвердить допуск к программе для такого размещения и для нативного клиента iOS.

> Health Story is a private family health journal with a hosted web app and a native iPhone app (bundle identifier `by.healthstory.familyjournal`). We would like adults to authorize their own ChatGPT accounts and use only the inference allowance included in their eligible plan. They can review the selected, de-identified text before sending a question and continue the conversation inside the journal. The journal stores the conversation encrypted in the selected family profile. The integration sends only the text needed for the request, including the previewed prior messages when continuing a conversation. Original files, full records, and family credentials are outside the integration. Please confirm whether a private family project is eligible and which OAuth client and redirect configuration you support for the hosted site and the native iPhone app. We would also like to confirm how to restrict usage to the included allowance without using credits after reaching the plan limit.

## Подключение на сайте и в iOS

Веб и нативное приложение используют один формат передачи. Запрос содержит список сообщений `{"messages":[{"role":"user","content":"…"}]}`. Успешный ответ содержит `answer` и `model`. Семейные ключи, ID пациента и файлы в этот запрос не входят. Когда контекст пришлось дополнительно обезличить, в истории сохраняются исходный локальный ответ и текст, который фактически ушёл с новым вопросом.

Статический сайт остаётся на GitHub Pages. Отдельный Cloudflare Worker принимает OAuth-возврат OpenAI и обслуживает запросы веба и iOS. Он проверяет подпись ID-токена, `nonce` и разрешение на использование тарифа. Одноразовый билет на возврате привязан к проверочному значению, которое создаёт клиент. Шлюз хранит OAuth-токены OpenAI в зашифрованном хранилище. Текст запроса передаётся OpenAI после проверки сессии и не сохраняется в шлюзе.

Веб хранит только временную сессию шлюза в памяти вкладки с лимитом в час. Для её восстановления после перезагрузки снова нажмите «Продолжить с ChatGPT». iPhone использует системное окно входа и хранит сессию шлюза в Keychain этого устройства отдельно для семьи и владельца профиля. Настройка находится на экране семьи под пунктом «Подключение ChatGPT». Ошибки подключения и квоты оставляют запрос в черновиках.

### Новый чат на iPhone

В консультации и ручном разборе лечения можно выбрать «Скопировать и открыть новый чат». Дневник проверяет подготовленный текст и сохраняет его в локальном буфере на пять минут. Затем iOS открывает новый разговор в приложении ChatGPT по ссылке без медицинских параметров. В ChatGPT выберите «Вставить» и отправьте сообщение. Если iOS не открыла приложение, дневник предлагает веб-версию.

В консультации действие «Сохранить запрос как TXT» создаёт файл из проверенного текста с выбранными данными. Его можно добавить в ChatGPT через «+». Исходные фото и PDF остаются в архиве. После возвращения ответ можно вставить в карточку консультации или разбора.

## После подтверждения доступа

1. Зарегистрировать `https://health-story-chatgpt.xzx89s.workers.dev/chatgpt/callback` в настройках выданного OAuth-клиента OpenAI для сайта и iOS. Возврат из шлюза на телефон открывает системную схему `by.healthstory.familyjournal.chatgpt://account/callback`. [Интеграция для сайта](https://developers.openai.com/siwc/website) · [Авторизация в iOS](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/)
2. Настроить `OPENAI_CLIENT_ID` и `OPENAI_TOKEN_AUTH` в окружении Worker. Если выдан confidential client, поместить `OPENAI_CLIENT_SECRET` в Cloudflare Secrets. Для `SESSION_SEAL_KEY` создать отдельный случайный ключ на 32 байта в формате base64url и поместить его в Cloudflare Secrets. Ключ шифрует записи OAuth в Durable Object.
3. Подтвердить у OpenAI доступ к запросам в пределах включённой квоты и условия запрета расхода кредитов для этой конфигурации. Установить `OPENAI_PLAN_ONLY_APPROVED=yes` только после этого подтверждения. Отправка требует активную сессию и разрешение на использование тарифа. При отсутствии подтверждения шлюз возвращает `available:false` и не инициирует вход. [Управление лимитами](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage) · [Условия OpenAI](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)

Шлюз собирается из `cloudflare/chatgpt` командой `npm ci`. Команда `npm test` запускает локальную проверку с синтетическим OAuth-провайдером. Тест не обращается к личному аккаунту.

## Приёмка на опубликованном сайте и на iPhone

1. Войти под собственным аккаунтом. Проверить, что в дневнике виден активный доступ к включённой квоте.
2. Отправить «Ответь одним словом: готово» из пустой консультации. Продолжить «Какое слово ты только что написал?». Проверить, что второй запрос содержит только первый вопрос, его ответ и новый вопрос.
3. Перезапустить дневник и открыть оба ответа в истории того же профиля. Проверить, что ребёнок может просматривать свою историю, а отправка требует права редактирования.
4. Проверить на тестовом провайдере отзыв доступа и ответ об исчерпании квоты. При ошибке черновик остаётся доступен, повторная отправка требует явного действия.
