import BusinessActivityConsole from "@/components/workspace/BusinessActivityConsole";

// The signed-in account is the actor; the selected, membership-verified
// organization is the business data boundary. Provider connections live in a
// separate settings area and are not used as business ownership evidence.
export default function UserPortalPage() {
  return <BusinessActivityConsole />;
}
