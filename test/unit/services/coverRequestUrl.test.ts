import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCoverRequestUrl } from '@/services/coverRequestUrl';

// test/unit/services/coverRequestUrl.test.ts
// 读封面字节/像素用的地址：网页端把不给自己 CORS 头的图床换成自家代理，其余原样；桌面端一律原样。

const proxied = (url: string) => `/api/lyric-proxy?url=${encodeURIComponent(url)}`;

describe('resolveCoverRequestUrl', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('网页端把 QQ 与酷狗封面交给自家代理', () => {
        expect(resolveCoverRequestUrl('https://y.gtimg.cn/music/photo_new/T002M.jpg')).toBe(proxied('https://y.gtimg.cn/music/photo_new/T002M.jpg'));
        expect(resolveCoverRequestUrl('https://imge.kugou.com/stdmusic/x.jpg')).toBe(proxied('https://imge.kugou.com/stdmusic/x.jpg'));
        expect(resolveCoverRequestUrl('https://c1.kgimg.com/stdmusic/x.jpg')).toBe(proxied('https://c1.kgimg.com/stdmusic/x.jpg'));
    });

    it('别的图床原样返回', () => {
        expect(resolveCoverRequestUrl('https://p1.music.126.net/cover.jpg')).toBe('https://p1.music.126.net/cover.jpg');
    });

    it('本地地址与 blob 不经过代理', () => {
        expect(resolveCoverRequestUrl('blob:https://music.example/1234')).toBe('blob:https://music.example/1234');
        expect(resolveCoverRequestUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(resolveCoverRequestUrl('not a url')).toBe('not a url');
    });

    it('桌面端封面直连，不走网页代理', () => {
        vi.stubGlobal('window', { electron: {} });
        expect(resolveCoverRequestUrl('https://y.gtimg.cn/music/photo_new/T002M.jpg')).toBe('https://y.gtimg.cn/music/photo_new/T002M.jpg');
    });
});
