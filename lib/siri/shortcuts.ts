/**
 * Siri Shortcuts bridge
 * เรียกผ่าน URL scheme ของ iOS Shortcuts (ต้องสร้าง Shortcut ชื่อตรงกันไว้บนเครื่อง)
 * ใช้งานฝั่ง client เท่านั้น (มี window)
 */

function runShortcut(name: string, input?: string) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams({ name });
  if (input) params.set("input", "text"), params.set("text", input);
  window.location.href = `shortcuts://run-shortcut?${params.toString()}`;
}

export function openLine() {
  if (typeof window === "undefined") return;
  window.location.href = "line://";
}

export function openDrive() {
  if (typeof window === "undefined") return;
  // เปิดแอป Google Drive (fallback เป็นเว็บ)
  window.location.href = "googledrive://";
  setTimeout(() => {
    window.open("https://drive.google.com", "_blank");
  }, 800);
}

export function sendLineMessage(contact: string, message: string) {
  // ส่งต่อให้ Siri Shortcut "SendLine" รับ {contact, message}
  runShortcut("SendLine", JSON.stringify({ contact, message }));
}
