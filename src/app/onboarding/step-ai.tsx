'use client';

import { useRouter } from 'next/navigation';
import { ModelsSection } from '../(app)/settings/models-section';
import { KeysSection } from '../(app)/settings/sections';
import { Button } from '../components/ui/button';
import { Banner } from '../components/ui/display';
import type { SettingsData } from '../lib/data/settings';
import { stepHref } from './steps';

export function StepAi({
  settings,
  ready,
  demo,
}: {
  settings: SettingsData;
  ready: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  return (
    <section aria-labelledby="step-ai" className="flex flex-col gap-4">
      <div>
        <h2 id="step-ai" className="text-sm font-semibold">
          Connect an AI provider
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The profile of your product is built from your website with a model, so this comes first.
          Use a cheap model for triage and stronger ones for qualifying and drafting. Any
          OpenAI-compatible endpoint works too, including local models.
        </p>
      </div>
      {demo ? (
        <Banner>Demo mode uses a simulated provider, so this step is already done.</Banner>
      ) : (
        <>
          <KeysSection data={settings} />
          <ModelsSection data={settings} />
        </>
      )}
      <div className="flex items-center justify-end gap-3">
        {!ready ? (
          <p className="text-xs text-muted-foreground">
            Save a key and a model for every stage to continue.
          </p>
        ) : null}
        <Button
          variant="primary"
          onClick={() => {
            router.push(stepHref('account'));
            router.refresh();
          }}
        >
          Continue
        </Button>
      </div>
    </section>
  );
}
