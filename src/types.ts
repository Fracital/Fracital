declare global {
    interface Window {
        Filer: FilerType,
    }
}

const FilerFS: any = window.Filer
export const Filer: FilerFS = new FilerFS.FileSystem()

export const dirExists = async (path: string): Promise<boolean> => {
    return new Promise((resolve) => {
        Filer.stat(path, (err: any, stats: any) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    resolve(false);
                } else {
                    console.error(err);
                    resolve(false);
                }
            } else {
                const exists = stats.type === "DIRECTORY";
                resolve(exists);
            }
        });
    });
};

export const fileExists = async (path: string): Promise<boolean> => {
    return new Promise((resolve) => {
        Filer.stat(path, (err: any, stats: any) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    resolve(false);
                } else {
                    console.error(err);
                    resolve(false);
                }
            } else {
                const exists = stats.type === "FILE";
                resolve(exists);
            }
        });
    });
}

export interface COM {
    theme: {
        getTheme: () => any
        setTheme: (name: string) => Promise<boolean>
    }
    fs: FilerFS
    buffer: any
    sh: any
}

export interface SongProps {
    title: string
    artist: string
    album: string
    genre: string
    year: string
    cover: string | any,
    src: string
}

export interface Track {
    id: string;
    title: string;
    artists: string | string[];
    album: string;
    genre: string;
    year: string | Date;
    cover: string;
    explicit: boolean;
    src?: string;
}