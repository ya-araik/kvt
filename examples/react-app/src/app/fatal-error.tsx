export function FatalError({ error }: { readonly error: unknown }) {
  return (
    <main className="fatal-error" role="alert">
      <h1>Приложение не запустилось</h1>
      <p>Проверьте консоль и убедитесь, что локальный API доступен.</p>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
    </main>
  )
}
