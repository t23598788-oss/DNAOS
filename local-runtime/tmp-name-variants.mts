import { dispatch } from "@/engines/validation/dispatcher";

for (const kw of ["ทวัฒชัย", "ธวัชชัย", "ทัฒชัย", "การช่าง"]) {
  const r: any = await dispatch("partner.find", { keyword: kw });
  const names = Array.isArray(r.data) ? r.data.slice(0, 8).map((x: any) => x.name) : null;
  console.log(`kw="${kw}"`, r.ok, "n=", Array.isArray(r.data) ? r.data.length : "-", JSON.stringify(names));
}
