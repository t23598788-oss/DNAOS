// Flex Message — confirms a location pin was received

interface LocationReceivedProps {
  address: string
  lat: number
  lng: number
}

export function locationReceivedFlex({ address, lat, lng }: LocationReceivedProps): object {
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#27ACB2",
      contents: [
        {
          type: "text",
          text: "📍 รับพิกัดแล้ว",
          color: "#FFFFFF",
          size: "md",
          weight: "bold",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: address,
          wrap: true,
          size: "sm",
          color: "#333333",
        },
        {
          type: "text",
          text: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          size: "xs",
          color: "#AAAAAA",
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "เปิดใน Google Maps",
            uri: `https://maps.google.com/?q=${lat},${lng}`,
          },
          style: "link",
          height: "sm",
          color: "#27ACB2",
        },
      ],
    },
  }
}
