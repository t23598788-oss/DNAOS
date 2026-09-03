# agent-target — the isolated write target for the real-Agent proof

หน้าที่: give §11's real coding-Agent proof somewhere safe to actually
mutate a file. It exists so the proof never has to touch production
business code to demonstrate that a confined Agent can write.

Nothing imports this folder. `subject.ts` below is deliberately trivial and
is REWRITTEN by every run of `../backbone-proof.test.ts` — its content at
rest carries no meaning, only the fact that a real, kernel-confined process
was able to change it and that a process outside its scope was not.

Input: an approved write scope naming this folder.
Output: `subject.ts`, mutated in place.
Dependency ที่อนุญาต: none.
สิ่งที่ห้ามแตะ: never import this from real code, and never widen the
proof's write scope beyond this folder.
