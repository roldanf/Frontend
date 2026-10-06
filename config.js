(function () {
    'use strict';

    const frontendPath = new URL('.', document.currentScript.src).pathname;
    const backendPath = frontendPath === '/lavalustui/' ? '../api/' : '../lavalust/api/';
    const backendApi = new URL(backendPath, document.currentScript.src).href.replace(/\/$/, '');
    window.LAVALUST_API_BASE_URL = 'https://backend-1-i3q5.onrender.com/api';
}());
