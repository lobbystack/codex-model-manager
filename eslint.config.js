//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [{ ignores: [".output/**", "release/**", "src/components/ui/chart.tsx"] }, ...tanstackConfig]
