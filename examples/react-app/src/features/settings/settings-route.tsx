import { Gauge, MoonStar, Palette, Sparkles } from 'lucide-react'
import { useAppTheme } from '../../app/theme/app-theme-context.js'
import { appThemeSchemes } from '../../app/theme/theme-schemes.js'

const motionOptions = [
  { id: 'system', label: 'Системная', description: 'Следовать настройкам устройства.' },
  { id: 'full', label: 'Полная', description: 'Все переходы и микроанимации.' },
  { id: 'reduced', label: 'Сокращённая', description: 'Короткие и спокойные переходы.' },
  { id: 'none', label: 'Без анимации', description: 'Мгновенные изменения интерфейса.' }
] as const

export function Component() {
  const theme = useAppTheme()
  return (
    <main id="main-content" className="page-shell settings-page" tabIndex={-1}>
      <header className="page-heading">
        <div>
          <span className="eyebrow">Персонализация</span>
          <h1>Настройки</h1>
          <p>Схема и режим движения сохраняются в localStorage и восстанавливаются при запуске.</p>
        </div>
        <span className="page-icon">
          <Palette aria-hidden="true" size={24} />
        </span>
      </header>

      <section className="settings-card" aria-labelledby="scheme-title">
        <div className="settings-section-heading">
          <span>
            <MoonStar aria-hidden="true" size={19} />
          </span>
          <div>
            <h2 id="scheme-title">Цветовая схема</h2>
            <p>Все цвета приходят из семантических токенов KVT.</p>
          </div>
        </div>
        <div className="theme-grid">
          {appThemeSchemes.map((scheme) => (
            <button
              key={scheme.id}
              type="button"
              className={`theme-option${theme.schemeId === scheme.id ? ' is-selected' : ''}`}
              aria-pressed={theme.schemeId === scheme.id}
              onClick={() => theme.setScheme(scheme.id)}
            >
              <span className="theme-preview">
                {scheme.swatches.map((color) => (
                  <i key={color} style={{ backgroundColor: color }} />
                ))}
              </span>
              <strong>{scheme.label}</strong>
              <small>{scheme.description}</small>
              {theme.schemeId === scheme.id ? <Checkmark /> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-card" aria-labelledby="motion-title">
        <div className="settings-section-heading">
          <span>
            <Gauge aria-hidden="true" size={19} />
          </span>
          <div>
            <h2 id="motion-title">Движение</h2>
            <p>Фреймворк преобразует выбор в duration-токены темы.</p>
          </div>
        </div>
        <div className="motion-options">
          {motionOptions.map((option) => (
            <label key={option.id} className="motion-option">
              <input
                type="radio"
                name="motion"
                value={option.id}
                checked={theme.motion === option.id}
                onChange={() => theme.setMotion(option.id)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <aside className="architecture-note">
        <Sparkles aria-hidden="true" size={20} />
        <p>
          <strong>Обычный lazy route.</strong> Этот экран разбит на отдельный React chunk, но не
          создаёт DI feature scope: ему не нужны сервисы и ViewModel.
        </p>
      </aside>
    </main>
  )
}

function Checkmark() {
  return (
    <span className="selected-check" aria-hidden="true">
      ✓
    </span>
  )
}
