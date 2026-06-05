import { ConfigProvider, Effect, type FileSystem } from "effect";

import { AppError } from "../../errors.js";

const emptyConfigProvider = ConfigProvider.fromUnknown({});

const optionalDotEnvProvider: Effect.Effect<
  ConfigProvider.ConfigProvider,
  AppError,
  FileSystem.FileSystem
> = ConfigProvider.fromDotEnv().pipe(
  Effect.catchIf(
    (error) => error.reason._tag === "NotFound",
    () => Effect.succeed(emptyConfigProvider),
  ),
  Effect.mapError(
    (cause) =>
      new AppError("config.missing", "Failed to read .env file.", {
        context: { path: ".env" },
        cause,
      }),
  ),
);

export const runtimeConfigProvider: Effect.Effect<
  ConfigProvider.ConfigProvider,
  AppError,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const envProvider = yield* ConfigProvider.ConfigProvider;
  const dotenvProvider = yield* optionalDotEnvProvider;

  return envProvider.pipe(ConfigProvider.orElse(dotenvProvider));
});
