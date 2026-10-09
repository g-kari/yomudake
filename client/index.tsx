import React from 'react';
import {createRoot} from 'react-dom/client';
import Editor from './editor';
const root=document.getElementById('root');
if(root)createRoot(root).render(<Editor signOutPath="/cdn-cgi/access/logout"/>);
