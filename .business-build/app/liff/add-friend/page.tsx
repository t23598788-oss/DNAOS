'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'

type Status = 'loading' | 'not-friend' | 'requesting' | 'friend' | 'error'

export default function AddFriendLIFF() {
  const [status, setStatus] = useState<Status>('loading')
  const [liffReady, setLiffReady] = useState(false)
  const [displayName, setDisplayName] = useState<string>('')

  useEffect(() => {
    if (!liffReady) return

    const liff = (window as any).liff
    const liffId = process.env.NEXT_PUBLIC_LIFF_ADD_FRIEND_ID

    if (!liffId) {
      setStatus('error')
      return
    }

    liff
      .init({ liffId })
      .then(async () => {
        if (!liff.isLoggedIn()) {
          // bot_prompt=aggressive → LINE แสดง popup "เพิ่มเพื่อน DNA OS" ระหว่าง login ทันที
          liff.login({
            redirectUri: window.location.href,
            bot_prompt: 'aggressive',
          })
          return
        }

        const profile = await liff.getProfile()
        setDisplayName(profile.displayName)

        const { friendFlag } = await liff.getFriendship()
        setStatus(friendFlag ? 'friend' : 'not-friend')
      })
      .catch((err: any) => {
        console.error('LIFF init error:', err)
        setStatus('error')
      })
  }, [liffReady])

  // ใช้กรณีที่ user login แล้วแต่ยังไม่ได้กด add friend ตอน login
  const handleAddFriend = async () => {
    const liff = (window as any).liff
    setStatus('requesting')
    try {
      await liff.requestFriendship()
      const { friendFlag } = await liff.getFriendship()
      setStatus(friendFlag ? 'friend' : 'not-friend')
    } catch {
      setStatus('error')
    }
  }

  return (
    <>
      <Script
        src="https://static.line-scdn.net/liff/edge/2/sdk.js"
        onLoad={() => setLiffReady(true)}
      />

      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-[#00B900] border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500 text-sm">กำลังโหลด...</p>
          </div>
        )}

        {status === 'not-friend' && (
          <div className="flex flex-col items-center gap-6 text-center max-w-xs">
            <div className="w-24 h-24 bg-[#00B900] rounded-full flex items-center justify-center shadow-lg">
              <svg viewBox="0 0 40 40" className="w-14 h-14 fill-white">
                <path d="M20 3C10.6 3 3 9.5 3 17.5c0 5.3 3.2 10 8.1 12.8L10 37l6.5-3.4c1.1.3 2.3.4 3.5.4 9.4 0 17-6.5 17-14.5S29.4 3 20 3z" />
              </svg>
            </div>

            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {displayName ? `สวัสดี ${displayName}` : 'สวัสดี!'}
              </h1>
              <p className="mt-2 text-gray-600 text-sm leading-relaxed">
                เพิ่ม <span className="font-semibold text-[#00B900]">DNA OS</span> เป็นเพื่อน
                <br />
                เพื่อรับบริการสั่งวัสดุก่อสร้าง
                <br />
                และติดตามงานได้ทันที
              </p>
            </div>

            <button
              onClick={handleAddFriend}
              className="w-full bg-[#00B900] hover:bg-[#009900] active:bg-[#008000] text-white font-bold py-4 px-8 rounded-2xl text-lg shadow-md transition-colors"
            >
              + เพิ่มเพื่อน DNA OS
            </button>

            <p className="text-xs text-gray-400">
              กดปุ่มด้านบนเพื่อยืนยันการเพิ่มเพื่อน
            </p>
          </div>
        )}

        {status === 'requesting' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-[#00B900] border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600 text-sm">กำลังดำเนินการ...</p>
          </div>
        )}

        {status === 'friend' && (
          <div className="flex flex-col items-center gap-6 text-center max-w-xs">
            <div className="w-24 h-24 bg-[#00B900] rounded-full flex items-center justify-center shadow-lg">
              <svg viewBox="0 0 24 24" className="w-12 h-12 stroke-white fill-none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <div>
              <h1 className="text-xl font-bold text-gray-900">เพิ่มเพื่อนสำเร็จ!</h1>
              <p className="mt-2 text-gray-600 text-sm leading-relaxed">
                {displayName ? `${displayName} ` : 'คุณ '}เป็นเพื่อนกับ DNA OS แล้ว
                <br />
                พิมพ์ข้อความมาได้เลยครับ
              </p>
            </div>

            <button
              onClick={() => (window as any).liff?.closeWindow()}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 px-8 rounded-2xl text-base transition-colors"
            >
              ปิดหน้าต่างนี้
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-4 text-center max-w-xs">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">⚠️</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">เกิดข้อผิดพลาด</h1>
              <p className="mt-1 text-gray-500 text-sm">
                กรุณาเปิดลิงก์นี้ใน LINE อีกครั้ง
              </p>
            </div>
            <p className="text-xs text-gray-400">LIFF ทำงานได้เฉพาะใน LINE เท่านั้น</p>
          </div>
        )}
      </div>
    </>
  )
}
