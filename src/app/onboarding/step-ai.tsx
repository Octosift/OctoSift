'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PresetId } from '@/core/ai/presets';
import {
  CodexPanel,
  initialProvider,
  PresetPicker,
  PROVIDER_CHOICES,
  ProviderChoice,
  type PresetProvider,
} from '../(app)/settings/ai-section';
import { SecretField } from '../(app)/settings/secret-field';
import { Button } from '../components/ui/button';
import { Banner } from '../components/ui/display';
import { choosePreset, refreshModelList } from '../lib/actions/ai';
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
  const ai = settings.ai;
  const [provider, setProvider] = useState<PresetProvider>(initialProvider(ai));
  const [preset, setPreset] = useState<PresetId>(ai.active?.preset ?? 'balanced');
  // Models chosen by hand in Settings are kept unless a preset is picked here.
  const [touched, setTouched] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Partial<Record<PresetProvider, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choice = PROVIDER_CHOICES[provider];
  const keyReady =
    savedKeys[provider] ?? (choice.keyName ? settings.secrets[choice.keyName].configured : false);
  const keepCustom = ready && ai.active === null && !touched;
  const canContinue = demo || keyReady || keepCustom;
  const next = () => {
    router.push(stepHref('account'));
    router.refresh();
  };

  return (
    <section aria-labelledby="step-ai" className="flex flex-col gap-4">
      <div>
        <h2 id="step-ai" className="text-xl font-semibold tracking-tight">
          Connect an AI provider
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste one API key. The preset picks a model for each step; you can change them later in
          Settings.
        </p>
      </div>
      {demo ? (
        <Banner>Demo mode uses a simulated provider, so this step is already done.</Banner>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <ProviderChoice
            value={provider}
            cli={ai.cliProviders}
            onChange={(id) => {
              setProvider(id);
              setTouched(true);
            }}
          />
          {choice.keyName ? (
            <SecretField
              key={choice.keyName}
              name={choice.keyName}
              label={choice.keyLabel}
              description={settings.secrets[choice.keyName]}
              onSaved={() => {
                setSavedKeys({ ...savedKeys, [provider]: true });
                startTransition(async () => {
                  await refreshModelList(provider);
                  router.refresh();
                });
              }}
              onRemoved={() => {
                setSavedKeys({ ...savedKeys, [provider]: false });
              }}
            />
          ) : (
            <CodexPanel
              onChecked={(ok) => {
                setSavedKeys({ ...savedKeys, [provider]: ok });
              }}
            />
          )}
          <PresetPicker
            options={ai.presets[provider]}
            value={preset}
            onChange={(id) => {
              setPreset(id);
              setTouched(true);
            }}
            volume={ai.volume}
          />
        </div>
      )}
      {error ? (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {!canContinue ? (
          <p className="text-xs text-muted-foreground">
            {choice.keyName ? 'Save a key to continue.' : 'Check Codex to continue.'}
          </p>
        ) : null}
        <Button
          variant="primary"
          disabled={pending || !canContinue}
          onClick={() => {
            if (demo || keepCustom) {
              next();
              return;
            }
            startTransition(async () => {
              const result = await choosePreset({ provider, preset });
              if (result.ok) next();
              else setError(result.error);
            });
          }}
        >
          Continue
        </Button>
      </div>
    </section>
  );
}
