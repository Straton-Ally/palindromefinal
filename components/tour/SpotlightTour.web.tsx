/**
 * Web keeps the original react-native-spotlight-tour provider.
 *
 * Expo Router bundles the native screen files into the web build too; this file keeps the
 * Skia-based native tour (SpotlightTour.tsx) out of the web bundle. Web screens (*.web.tsx)
 * import the library directly and are unaffected.
 */
export { SpotlightTourProvider } from 'react-native-spotlight-tour';
export type { TourState, TourStep } from 'react-native-spotlight-tour';
