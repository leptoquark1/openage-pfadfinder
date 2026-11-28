import { useCallback, useId, useState } from 'react';
import {
  CROWD_SETTING_RANGES,
  type CrowdSettings,
  DEFAULT_CROWD_SETTINGS,
  type GuidanceMode,
  type SideSetting,
} from '../world/crowd.js';
import type { World } from '../world/world.js';

interface CrowdPanelProps {
  world: World;
}

/**
 * HUD for the crowd parameters: side rule, guidance, avoidance, personal
 * space, replan interval and congestion. Changes go straight to the world,
 * which applies them to the running simulation.
 */
export function CrowdPanel({ world }: CrowdPanelProps) {
  const [settings, setSettings] = useState<CrowdSettings>(() => world.getCrowdSettings());

  const update = useCallback(
    (patch: Partial<CrowdSettings>) => {
      world.setCrowdSettings(patch);
      setSettings(world.getCrowdSettings());
    },
    [world],
  );

  return (
    <section
      aria-label="Crowd settings"
      className="absolute top-16 right-3.5 flex w-64 flex-col gap-2.5 rounded-lg border border-border bg-panel/85 px-3 py-2 font-mono text-[11px] text-muted backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-divider pb-1">
        <span className="tracking-[0.08em] text-[10px] text-section">CROWD</span>
        <button
          type="button"
          className="rounded px-1 text-[10px] text-muted hover:text-fg"
          onClick={() => update(DEFAULT_CROWD_SETTINGS)}
        >
          defaults
        </button>
      </div>

      <Segmented<SideSetting>
        label="Side rule"
        value={settings.side}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'off', label: 'Off' },
        ]}
        onChange={side => update({ side })}
      />
      <Segmented<GuidanceMode>
        label="Steering"
        value={settings.guidance}
        options={[
          { value: 'flow', label: 'Flow field' },
          { value: 'path', label: 'Single path' },
        ]}
        onChange={guidance => update({ guidance })}
      />

      <Slider
        label="Avoidance"
        value={settings.avoidance}
        range={CROWD_SETTING_RANGES.avoidance}
        format={v => v.toFixed(1)}
        onChange={avoidance => update({ avoidance })}
      />
      <Slider
        label="Look-ahead"
        value={settings.lookahead}
        range={CROWD_SETTING_RANGES.lookahead}
        format={v => `${v.toFixed(1)} s`}
        onChange={lookahead => update({ lookahead })}
      />
      <Slider
        label="Personal space"
        value={settings.personalSpace}
        range={CROWD_SETTING_RANGES.personalSpace}
        format={v => `${v.toFixed(2)} cells`}
        onChange={personalSpace => update({ personalSpace })}
      />
      <Slider
        label="Replan interval"
        value={settings.replanInterval}
        range={CROWD_SETTING_RANGES.replanInterval}
        format={v => `${v} ms`}
        onChange={replanInterval => update({ replanInterval })}
      />

      <div className="flex flex-col gap-1 border-t border-border pt-2">
        <label className="flex cursor-pointer items-center justify-between">
          <span>Congestion costs</span>
          <input
            type="checkbox"
            className="accent-current"
            checked={settings.congestion}
            onChange={e => update({ congestion: e.target.checked })}
          />
        </label>
        <Slider
          label="Cost per density"
          value={settings.congestionCost}
          range={CROWD_SETTING_RANGES.congestionCost}
          format={v => `${v}`}
          disabled={!settings.congestion}
          onChange={congestionCost => update({ congestionCost })}
        />
      </div>
    </section>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="flex flex-col gap-1">
      <span>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex rounded-md border border-border p-0.5">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded px-1 py-1 text-[11px] transition-colors duration-150 ${
              option.value === value ? 'bg-bg text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  range: { readonly min: number; readonly max: number; readonly step: number };
  format: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function Slider({ label, value, range, format, disabled = false, onChange }: SliderProps) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-0.5 ${disabled ? 'opacity-50' : ''}`}>
      <label htmlFor={id} className="flex justify-between">
        <span>{label}</span>
        <span className="text-fg">{format(value)}</span>
      </label>
      <input
        id={id}
        type="range"
        className="w-full accent-current"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}
