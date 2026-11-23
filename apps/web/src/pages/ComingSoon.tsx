import { Construction } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export function ComingSoon({ title, phase, description }: { title: string; phase: string; description: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={<Construction className="size-5" />} title={`${phase} mein aa raha hai`} description={description} />
      </Card>
    </div>
  );
}
