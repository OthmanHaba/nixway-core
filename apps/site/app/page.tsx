import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Hero } from "@/components/landing/Hero";
import { LiveDemo } from "@/components/landing/LiveDemo";
import { RunsOn } from "@/components/landing/RunsOn";
import { Pillars } from "@/components/landing/Pillars";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Architecture } from "@/components/landing/Architecture";
import { PricingTeaser } from "@/components/landing/PricingTeaser";
import { ForFounders } from "@/components/landing/ForFounders";
import { FinalCta } from "@/components/landing/FinalCta";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <LiveDemo />
        <RunsOn />
        <Pillars />
        <HowItWorks />
        <Architecture />
        <PricingTeaser />
        <ForFounders />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
