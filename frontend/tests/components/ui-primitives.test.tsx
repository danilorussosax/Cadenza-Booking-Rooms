import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

describe('ui/Button', () => {
  it('render con label', () => {
    render(<Button>Salva</Button>);
    expect(screen.getByRole('button', { name: 'Salva' })).toBeInTheDocument();
  });
  it('chiama onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Tap</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('disabled previene il click', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
  it('varianti applicate', () => {
    render(<Button variant="destructive">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-destructive');
  });
  it('size sm/lg/xl/icon non crashano', () => {
    const sizes = ['default', 'sm', 'lg', 'xl', 'icon'] as const;
    sizes.forEach((s) => {
      const { unmount } = render(<Button size={s}>x</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
      unmount();
    });
  });
});

describe('ui/Badge', () => {
  it('render con varianti', () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });
  it('varianti', () => {
    const variants = ['default', 'secondary', 'destructive', 'success', 'muted'] as const;
    variants.forEach((v) => {
      const { unmount } = render(<Badge variant={v}>x</Badge>);
      expect(screen.getByText('x')).toBeInTheDocument();
      unmount();
    });
  });
});

describe('ui/Card', () => {
  it('compone Card con header + content', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Titolo</CardTitle>
        </CardHeader>
        <CardContent>Contenuto</CardContent>
      </Card>,
    );
    expect(screen.getByText('Titolo')).toBeInTheDocument();
    expect(screen.getByText('Contenuto')).toBeInTheDocument();
  });
});

describe('ui/Input', () => {
  it('controlled input', async () => {
    const onChange = vi.fn();
    render(<Input value="hello" onChange={onChange} />);
    const input = screen.getByDisplayValue('hello') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    await userEvent.type(input, 'x');
    expect(onChange).toHaveBeenCalled();
  });
  it('disabled', () => {
    render(<Input disabled value="x" onChange={() => {}} />);
    expect(screen.getByDisplayValue('x')).toBeDisabled();
  });
});

describe('ui/Label', () => {
  it('renderizza con htmlFor', () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" />
      </>,
    );
    expect(screen.getByText('Email')).toBeInTheDocument();
  });
});

describe('ui/Textarea', () => {
  it('multi-line input', async () => {
    const onChange = vi.fn();
    render(<Textarea value="a" onChange={onChange} rows={3} />);
    const ta = screen.getByDisplayValue('a');
    expect(ta).toBeInTheDocument();
    await userEvent.type(ta, 'b');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('ui/Skeleton', () => {
  it('render con classi pulse', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    expect(container.firstChild).toHaveClass('h-4');
  });
});

describe('ui/Separator', () => {
  it('orientazione horizontal/vertical', () => {
    const { rerender, container } = render(<Separator orientation="horizontal" />);
    expect(container.firstChild).toBeInTheDocument();
    rerender(<Separator orientation="vertical" />);
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe('ui/Avatar', () => {
  it('render fallback se manca image', () => {
    render(
      <Avatar>
        <AvatarFallback>MR</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('MR')).toBeInTheDocument();
  });
});

describe('ui/Alert', () => {
  it('alert con title + description', () => {
    render(
      <Alert>
        <AlertTitle>Attenzione</AlertTitle>
        <AlertDescription>Operazione non riuscita</AlertDescription>
      </Alert>,
    );
    expect(screen.getByText('Attenzione')).toBeInTheDocument();
    expect(screen.getByText('Operazione non riuscita')).toBeInTheDocument();
  });
});

describe('ui/Tabs', () => {
  it('tab switch via click', async () => {
    render(
      <Tabs defaultValue="t1">
        <TabsList>
          <TabsTrigger value="t1">Tab 1</TabsTrigger>
          <TabsTrigger value="t2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="t1">Content 1</TabsContent>
        <TabsContent value="t2">Content 2</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('Content 1')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Tab 2'));
    expect(screen.getByText('Content 2')).toBeInTheDocument();
  });
});

describe('ui/Switch', () => {
  it('toggle on/off', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('ui/Checkbox', () => {
  it('toggle check', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).toHaveBeenCalled();
  });
});
