import {
  ViewModel,
  bind,
  createToken,
  defineModule,
  provide,
  type NoInputUseCase,
  type UseCase as UseCaseContract,
  type UseCaseContext
} from '../src/index.js'

abstract class Repository {
  abstract read(): string
}
class MemoryRepository extends Repository {
  read(): string {
    return 'ready'
  }
}
class UseCase {
  constructor(
    readonly repository: Repository,
    readonly limit: number
  ) {}
}
class ExampleViewModel extends ViewModel {
  constructor(readonly useCase: UseCase) {
    super()
  }
}
class NotAViewModel {}

class RefreshUseCase implements NoInputUseCase<string> {
  execute(_context: UseCaseContext): string {
    return 'ready'
  }
}

class LookupUseCase implements UseCaseContract<string, number> {
  execute(input: string, _context: UseCaseContext): number {
    return input.length
  }
}

export class RunnerViewModel extends ViewModel {
  check(): void {
    void this.viewModelScope.run(new RefreshUseCase())
    void this.viewModelScope.run(new LookupUseCase(), 'value')
    // @ts-expect-error An input use case requires its input value.
    void this.viewModelScope.run(new LookupUseCase())
    // @ts-expect-error A no-input use case does not accept a placeholder input.
    void this.viewModelScope.run(new RefreshUseCase(), undefined)
  }
}

const limit = createToken<number>('limit')

defineModule({
  id: 'valid-types',
  version: '1.0.0',
  providers: [
    bind(Repository).to(MemoryRepository).singleton(),
    provide(limit).value(10),
    bind(UseCase).inject(Repository, limit),
    bind(ExampleViewModel).inject(UseCase).viewModel()
  ]
})

provide(UseCase)
  .inject(Repository, limit)
  .using((repository, value) => new UseCase(repository, value))
provide(UseCase)
  .inject(Repository, limit)
  .usingAsync(async (repository, value) => new UseCase(repository, value))

// @ts-expect-error Dependency order must match constructor parameters.
bind(UseCase).inject(limit, Repository)
// @ts-expect-error Missing constructor dependency.
bind(UseCase).inject(Repository)
defineModule({
  id: 'abstract-incomplete',
  version: '1.0.0',
  // @ts-expect-error An abstract contract is incomplete without to()/using().
  providers: [bind(Repository)]
})
// @ts-expect-error viewModel() only accepts ViewModel subclasses.
bind(NotAViewModel).viewModel()
// @ts-expect-error A ViewModel lifetime cannot be combined with singleton.
bind(ExampleViewModel).viewModel().singleton()
// @ts-expect-error A singleton cannot later become a ViewModel.
bind(ExampleViewModel).singleton().viewModel()
// @ts-expect-error Eager transient providers are forbidden by the DSL.
bind(UseCase).transient().eager()
