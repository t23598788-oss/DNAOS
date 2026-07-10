"use client";

// UIKit — WindowLayer
// อ่าน windows[] จาก useWorkspace() แล้ว render component ที่ถูกต้องตาม key
// วาง component นี้ไว้เป็นลูกของ <WorkspaceCanvas> เพียงครั้งเดียว — ไม่ต้อง import Dock/Drawer/... เองที่หน้าเรียกใช้
// เพิ่ม component ใหม่ในอนาคต = เพิ่ม case ที่นี่ที่เดียว ไม่ต้องแก้ตำแหน่งอื่น

import { useWorkspace } from "./WorkspaceCanvas";
import Inspector, { type InspectorField } from "./Inspector";
import Timeline, { type TimelineEvent } from "./Timeline";
import DataTable, { type DataTableColumn } from "./DataTable";
import MapView, { type MapMarker } from "./MapView";
import ChatPanel, { type ChatMessage } from "./ChatPanel";
import DocumentViewer from "./DocumentViewer";
import PartnerCard, { type PartnerCardProps } from "./PartnerCard";

export default function WindowLayer() {
  const { windows, close } = useWorkspace();

  if (windows.length === 0) return null;

  return (
    <div className="absolute inset-0 z-10 flex items-start justify-end flex-wrap gap-3 p-4 pointer-events-none [&>*]:pointer-events-auto">
      {windows.map((w) => {
        const onClose = () => close(w.id);
        const props = w.props ?? {};

        switch (w.key) {
          case "inspector":
            return (
              <Inspector
                key={w.id}
                title={props.title ?? "Inspector"}
                fields={(props.fields as InspectorField[]) ?? []}
                onClose={onClose}
              />
            );
          case "timeline":
            return (
              <Timeline
                key={w.id}
                title={props.title}
                events={(props.events as TimelineEvent[]) ?? []}
                onClose={onClose}
              />
            );
          case "table":
            return (
              <DataTable
                key={w.id}
                title={props.title}
                columns={(props.columns as DataTableColumn[]) ?? []}
                rows={props.rows ?? []}
                onRowClick={props.onRowClick}
                onClose={onClose}
              />
            );
          case "map":
            return (
              <MapView
                key={w.id}
                title={props.title}
                markers={(props.markers as MapMarker[]) ?? []}
                onClose={onClose}
              />
            );
          case "chat":
            return (
              <ChatPanel
                key={w.id}
                title={props.title}
                messages={(props.messages as ChatMessage[]) ?? []}
                onSend={props.onSend}
                onClose={onClose}
              />
            );
          case "document":
            return (
              <DocumentViewer
                key={w.id}
                documentType={props.documentType ?? "quotation"}
                documentNumber={props.documentNumber}
                status={props.status}
                htmlContent={props.htmlContent}
                onClose={onClose}
              />
            );
          case "partnerCard":
            return (
              <div key={w.id} className="w-80">
                <PartnerCard {...(props as PartnerCardProps)} />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
