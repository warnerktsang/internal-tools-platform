import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';

export function SelectPrincipal() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No principal selected</CardTitle>
      </CardHeader>
      <CardBody className="text-sm text-neutral-600">
        Pick someone in the &ldquo;Acting as&rdquo; switcher above. Authentication is seeded for the
        prototype, but the roles and scopes it hands to the policy engine are real database rows.
      </CardBody>
    </Card>
  );
}
