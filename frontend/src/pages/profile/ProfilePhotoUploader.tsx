import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImageUp, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { authApi } from '@/api/auth';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { ProfileUser, UpdateUserFn } from './types';

// =====================================================
// Profile photo uploader (avatar + carica/cambia/rimuovi)
// =====================================================
export function ProfilePhotoUploader({
  user,
  updateUser,
}: {
  user: ProfileUser;
  updateUser: UpdateUserFn;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const initials = `${user.firstName[0]}${user.lastName[0]}`;
  const hasPhoto = !!user.profilePhotoUrl;

  const uploadMutation = useMutation({
    mutationFn: (file: File) => authApi.uploadPhoto(file),
    onSuccess: ({ user: updated }) => {
      toast.success('Foto profilo aggiornata');
      updateUser(updated);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => authApi.deletePhoto(),
    onSuccess: ({ user: updated }) => {
      toast.success('Foto profilo rimossa');
      updateUser(updated);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const busy = uploadMutation.isPending || deleteMutation.isPending;

  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar className="h-16 w-16 ring-1 ring-border sm:h-20 sm:w-20">
        {hasPhoto && <AvatarImage src={user.profilePhotoUrl ?? ''} alt="Foto profilo" />}
        <AvatarFallback className="bg-primary/10 text-lg text-primary">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {uploadMutation.isPending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImageUp className="h-3.5 w-3.5" />
          )}
          {hasPhoto ? 'Cambia' : 'Carica foto'}
        </Button>
        {hasPhoto && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Rimuovi foto"
            onClick={() => {
              deleteMutation.mutate();
            }}
            disabled={busy}
            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {deleteMutation.isPending ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
      <p className="hidden text-[11px] text-muted-foreground sm:block">
        PNG · JPG · WEBP · max 2 MB
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadMutation.mutate(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
