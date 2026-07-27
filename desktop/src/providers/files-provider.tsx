import { ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSingleInstance } from '~/lib/use-single-instance'
import { ModifyState, NamedPath } from '~/lib/types'

type FilesProviderState = NamedPath[]
interface FilesProviderContextType {
	files: FilesProviderState
	setFiles: ModifyState<FilesProviderState>
}

export const FilesProviderContext = createContext<FilesProviderContextType>({} as FilesProviderContextType)

export function useFilesContext() {
	return useContext(FilesProviderContext) as FilesProviderContextType
}

export function FilesProvider({ children }: { children: ReactNode }) {
	const [files, setFiles] = useState<FilesProviderState>([])
	const location = useLocation()
	useSingleInstance({ setFiles })

	useEffect(() => {
		if (location?.state?.files) {
			setFiles(location?.state?.files)
		}
	}, [])
	return <FilesProviderContext.Provider value={{ files, setFiles }}>{children}</FilesProviderContext.Provider>
}
