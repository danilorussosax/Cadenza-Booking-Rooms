import { buildProviderTk } from '@/pages/admin/integrations/isidata/isidataHelpers';
import { useRef } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface UploadStepProps {
  tk: ReturnType<typeof buildProviderTk>;
  file: File | null;
  onFileChange: (f: File) => void;
  previewing: boolean;
  onPreview: () => void;
}

export function UploadStep({ tk, file, onFileChange, previewing, onPreview }: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files.item(0);
    if (f) onFileChange(f);
  };
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          {tk('step1_title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-0 sm:pt-0">
        <label
          htmlFor="isidata-file"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-10 text-center transition-colors hover:border-primary/60 hover:bg-primary/5',
            file && 'border-primary/70 bg-primary/10',
          )}
        >
          <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">{file ? file.name : tk('dropzone_label')}</p>
          <p className="text-xs text-muted-foreground">{tk('dropzone_hint')}</p>
          <input
            id="isidata-file"
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileChange(f);
            }}
          />
        </label>

        <p className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
          {tk('mapping_upload_hint')}
        </p>

        <div className="flex justify-end gap-2">
          <Button onClick={onPreview} disabled={!file || previewing}>
            {previewing && <Loader2 className="h-4 w-4 animate-spin" />}
            {tk('preview_action')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
