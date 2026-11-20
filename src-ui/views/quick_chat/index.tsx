import { createRoot } from 'react-dom/client';
import '../../../locales/config';
import '../app/_index_css/root.css';
import { QuickChat } from './QuickChat';

const root = document.getElementById('root');
if (root) createRoot(root).render(<QuickChat />);
