import { createRoot } from 'react-dom/client';
import '../../../locales/config';
import '../app/_index_css/root.css';
import { QuickChat } from './QuickChat';
import { applyStartupTheme } from '../../logics/theme/startupTheme.ts';

// The saved theme from the first paint (#1259): in place before the first render.
applyStartupTheme();

const root = document.getElementById('root');
if (root) createRoot(root).render(<QuickChat />);
