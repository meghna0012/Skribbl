// No router and no StrictMode wrapper. The screen is chosen from socket state in App.
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
