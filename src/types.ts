declare global {
    interface Window {
        Filer: FilerType,
        ScramjetController: any
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