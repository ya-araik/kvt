import { defineConfig } from 'vitepress'

const base = process.env.KVT_DOCS_BASE ?? '/'

export default defineConfig({
  lang: 'ru-RU',
  title: 'KVT Framework',
  description: 'Подробная документация KVT: runtime, DI, Flow, ViewModel, React, Router, Theme и Query.',
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#11131a' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'KVT Framework' }],
    ['meta', { property: 'og:description', content: 'Renderer-independent TypeScript framework с явным lifecycle и Kotlin-like Flow.' }]
  ],
  themeConfig: {
    siteTitle: 'KVT',
    nav: [
      { text: 'Начало', link: '/guide/introduction' },
      { text: 'Руководство', link: '/guide/mental-model' },
      { text: 'Todo example', link: '/guide/react-example' },
      { text: 'API', link: '/api/', target: '_blank' },
      { text: 'GitHub', link: 'https://github.com/ya-araik/kvt' }
    ],
    sidebar: [
      {
        text: 'Начало',
        items: [
          { text: 'Что такое KVT', link: '/guide/introduction' },
          { text: 'Установка и первый запуск', link: '/guide/getting-started' },
          { text: 'Clean Architecture', link: '/guide/clean-architecture' },
          { text: 'Ментальная модель', link: '/guide/mental-model' },
          { text: 'Карта пакетов', link: '/guide/packages' },
          { text: 'Разбор Todo example', link: '/guide/react-example' }
        ]
      },
      {
        text: 'Основа framework',
        items: [
          { text: 'Runtime и lifecycle', link: '/core/runtime-lifecycle' },
          { text: 'DI: bind и provide', link: '/core/dependency-injection' },
          { text: 'Scopes и ownership', link: '/core/scopes-ownership' },
          { text: 'Modules, plugins, features', link: '/core/modules-plugins-features' },
          { text: 'Result и UseCase', link: '/core/result-use-case' },
          { text: 'Ошибки и diagnostics', link: '/core/errors-diagnostics' }
        ]
      },
      {
        text: 'State и асинхронность',
        items: [
          { text: 'Flow: общая картина', link: '/state/flow-overview' },
          { text: 'StateFlow', link: '/state/state-flow' },
          { text: 'SharedFlow и события', link: '/state/shared-flow' },
          { text: 'Cold Flow и operators', link: '/state/cold-flow' },
          { text: 'TaskController и AsyncState', link: '/state/tasks' }
        ]
      },
      {
        text: 'Application layer',
        items: [
          { text: 'ViewModel lifecycle', link: '/application/view-model' },
          { text: 'React integration', link: '/application/react' },
          { text: 'Router и lazy features', link: '/application/router' },
          { text: 'SSR и hydration', link: '/application/ssr-hydration' },
          { text: 'Query и server state', link: '/application/query' }
        ]
      },
      {
        text: 'UI и эксплуатация',
        items: [
          { text: 'Theme core', link: '/ui/theme-core' },
          { text: 'Theme React', link: '/ui/theme-react' },
          { text: 'Tailwind CSS', link: '/ui/tailwind' },
          { text: 'Testing', link: '/operations/testing' },
          { text: 'Lint и форматирование', link: '/operations/code-quality' },
          { text: 'DevTools и OpenTelemetry', link: '/operations/observability' },
          { text: 'CLI и generators', link: '/operations/cli' },
          { text: 'Production checklist', link: '/operations/production' }
        ]
      },
      {
        text: 'Справочник',
        items: [
          { text: 'Архитектурные рецепты', link: '/reference/recipes' },
          { text: 'Переход с prototype', link: '/reference/prototype-migration' },
          { text: 'Типичные ошибки', link: '/reference/troubleshooting' },
          { text: 'Глоссарий', link: '/reference/glossary' },
          { text: 'Сгенерированный API ↗', link: '/api/' }
        ]
      }
    ],
    outline: { level: [2, 3], label: 'На этой странице' },
    search: {
      provider: 'local',
      options: {
        detailedView: true,
        translations: {
          button: { buttonText: 'Поиск', buttonAriaLabel: 'Поиск по документации' },
          modal: {
            displayDetails: 'Показать подробности',
            resetButtonTitle: 'Сбросить поиск',
            backButtonTitle: 'Закрыть поиск',
            noResultsText: 'Ничего не найдено',
            footer: {
              selectText: 'выбрать',
              navigateText: 'перейти',
              closeText: 'закрыть'
            }
          }
        }
      }
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/ya-araik/kvt' }],
    editLink: {
      pattern: 'https://github.com/ya-araik/kvt/edit/main/website/:path',
      text: 'Исправить эту страницу на GitHub'
    },
    lastUpdated: { text: 'Обновлено', formatOptions: { dateStyle: 'medium', timeStyle: 'short' } },
    docFooter: { prev: 'Предыдущая', next: 'Следующая' },
    darkModeSwitchLabel: 'Тема',
    lightModeSwitchTitle: 'Светлая тема',
    darkModeSwitchTitle: 'Тёмная тема',
    sidebarMenuLabel: 'Меню',
    returnToTopLabel: 'Наверх',
    footer: {
      message: 'Документация KVT Framework 1.0',
      copyright: 'Copyright © 2026 Araik Gukasyan · MIT License'
    }
  }
})
