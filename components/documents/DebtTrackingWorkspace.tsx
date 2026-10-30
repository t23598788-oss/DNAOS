'use client'

import { useState } from 'react'
import DebtTrackingManager from './DebtTrackingManager'
import DebtReminderWorkbench from './DebtReminderWorkbench'

/**
 * The existing debt-tracking workspace, with the collection workbench as a second
 * tab — one workspace, one route, no parallel application (M026).
 */
export default function DebtTrackingWorkspace() {
  const [tab, setTab] = useState<'tracking' | 'reminders'>('tracking')

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="px-6 pt-4 bg-white border-b border-stone-200 shrink-0">
        <div className="flex gap-1">
          <button
            className={`px-3 py-2 text-xs rounded-t-lg border-b-2 ${
              tab === 'tracking'
                ? 'border-stone-800 text-stone-900 font-semibold'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
            onClick={() => setTab('tracking')}
          >
            รายการติดตามหนี้
          </button>
          <button
            className={`px-3 py-2 text-xs rounded-t-lg border-b-2 ${
              tab === 'reminders'
                ? 'border-stone-800 text-stone-900 font-semibold'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
            onClick={() => setTab('reminders')}
          >
            ติดตามหนี้ — ใบแจ้งหนี้
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'tracking' ? (
          <DebtTrackingManager />
        ) : (
          <div className="p-6">
            <DebtReminderWorkbench />
          </div>
        )}
      </div>
    </div>
  )
}
