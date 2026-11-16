export type WindowGeometryKey = "x_pos" | "y_pos" | "width" | "height";

// The window geometry as the backend sends it. The values may be numbers or numeric strings.
export type WindowGeometry = { readonly [K in WindowGeometryKey]?: unknown };

// The geometry the backend sends until the user has moved or resized the window
// (MAIN_WINDOW_GEOMETRY in src-python/config.py).
export const BUILT_IN_GEOMETRY = { x_pos: 0, y_pos: 0, width: 870, height: 654 } satisfies Record<WindowGeometryKey, number>;

// parseInt converts its argument to a string, so the values are passed as they are.
export const isBuiltInGeometry = (geometry: WindowGeometry | null | undefined): boolean =>
    (Object.keys(BUILT_IN_GEOMETRY) as WindowGeometryKey[]).every(key => parseInt(geometry?.[key] as string) === BUILT_IN_GEOMETRY[key]);

// The window's size is saved and restored in physical pixels, but the built-in size
// is meant in CSS pixels. At 125% display scaling, 870x654 physical pixels are
// 696x523 CSS pixels: the first window opened in the narrow layout, with the
// sidebar's language readout cut off. While the geometry is still the built-in one,
// the size is multiplied by the monitor's scale factor. The window then saves its
// real size, so this applies once.
export const sizeToRestore = (geometry: WindowGeometry, scaleFactor: number): { width: number; height: number } => {
    const scale = isBuiltInGeometry(geometry) && scaleFactor > 1 ? scaleFactor : 1;
    return {
        width: Math.round(parseInt(geometry.width as string) * scale),
        height: Math.round(parseInt(geometry.height as string) * scale),
    };
};
