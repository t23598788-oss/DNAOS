# models/ — NOT_YET_BUILT

The shape of data for each destination type this system knows about
(Identity Store, Business Data Store, Control Store, Model/Agent Store,
Document Store — the categories named in the Owner's EMS description),
independent of which real backend currently holds it.

**Responsibility:** define what a record of each type looks like, so a
connector's adapter can be swapped (e.g. Supabase → something else for one
data type) without the rest of the system needing to know or care.

No models defined yet — deliberately, since `identity-model.ts` in
`../contracts/` already covers the identity axis, and no other data type
has a real destination adapter yet to design against (see
`../connectors/README.md`).
