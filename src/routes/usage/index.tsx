import { createFileRoute } from "@tanstack/react-router"

import { UsageCostChart } from "./-components/UsageCostChart"

export const Route = createFileRoute("/usage/")({
  component: UsagePage,
})

function UsagePage() {
  return (
    <>
      <header className="flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6 lg:h-[60px]">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">Usage</h1>
          <p className="text-sm text-muted-foreground">
            Estimated cost by model
          </p>
        </div>
      </header>
      <main className="flex w-full flex-1 flex-col gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
        <UsageCostChart />
      </main>
    </>
  )
}
