#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";

import { CliService } from "./cli/index.js";
import { AppError, errorDetails, errorMessage } from "./errors.js";

const main = CliService.use((cli) => cli.run(process.argv.slice(2))).pipe(
  Effect.provide(CliService.layer),
  Effect.catch((error: unknown) =>
    Effect.gen(function* () {
      yield* Console.error(errorMessage(error));
      const details = errorDetails(error);
      if (Object.keys(details).length > 0) {
        yield* Console.error(JSON.stringify(details));
      }
      yield* Effect.sync(() => {
        process.exitCode = error instanceof AppError ? error.exitCode : 1;
      });
    }),
  ),
);

NodeRuntime.runMain(main, { disableErrorReporting: true });
