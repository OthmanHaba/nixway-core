import { DocsHeader } from "@/components/docs/DocsHeader";
import { DocsSidebar } from "@/components/docs/DocsSidebar";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <DocsHeader />
      <div className="flex-1 max-w-[1240px] w-full mx-auto flex">
        <DocsSidebar />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
