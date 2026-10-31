export const COST_INIT: number = 0;
export const COST_MIN: number = 1;
export const COST_MAX: number = 254;
export const COST_IMPASSABLE: number = 255;

export const INTEGRATED_COST_START: number = 0;
export const INTEGRATED_COST_UNREACHABLE: number = 65535;

export const INTEGRATE_LOS_MASK: number = 0x20;
export const INTEGRATE_TARGET_MASK: number = 0x40;
export const INTEGRATE_FOUND_MASK: number = 0x02;
export const INTEGRATE_WAVEFRONT_BLOCKED_MASK: number = 0x04;

export const FLOW_INIT: number = 0;
export const FLOW_DIR_MASK: number = 0x0f;
export const FLOW_FLAGS_MASK: number = 0xf0;
export const FLOW_PATHABLE_MASK: number = 0x10;
export const FLOW_LOS_MASK: number = 0x20;
export const FLOW_TARGET_MASK: number = 0x40;
