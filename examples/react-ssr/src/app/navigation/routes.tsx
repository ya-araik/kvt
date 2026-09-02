import type { RouteObject } from 'react-router'
import { App } from '../app.js'
import { AboutPage } from '../../presentation/view/about-page.js'
import { TodoPage } from '../../presentation/view/todo-page.js'

export const routes: readonly RouteObject[] = [
  {
    path: '/',
    Component: App,
    children: [
      { index: true, Component: TodoPage },
      { path: 'about', Component: AboutPage }
    ]
  }
]
