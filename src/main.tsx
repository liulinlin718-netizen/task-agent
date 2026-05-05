import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import FloatingBallWindow from './components/FloatingBallWindow.tsx';
import FloatingTaskCenterWindow from './components/FloatingTaskCenterWindow.tsx';
import './index.css';

// Determine which window to render based on URL parameter
const params = new URLSearchParams(window.location.search);
const windowType = params.get('window');

function RootComponent() {
  switch (windowType) {
    case 'ball':
      return <FloatingBallWindow />;
    case 'taskcenter':
      return <FloatingTaskCenterWindow />;
    default:
      return <App />;
  }
}

// For floating windows, make document background transparent
if (windowType === 'ball' || windowType === 'taskcenter') {
  document.documentElement.style.setProperty('background', 'transparent', 'important');
  document.body.style.setProperty('background', 'transparent', 'important');
  const root = document.getElementById('root');
  if (root) root.style.setProperty('background', 'transparent', 'important');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
);
