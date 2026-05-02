import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { FieldError } from '@/components/ui/field-error';

// Smoke a11y: scansioniamo i building block usati ovunque + un form
// realistico con e senza errori. Catturiamo regressioni macroscopiche
// (label-input mismatch, aria-* errati, contrasto evidente, ruoli rotti).

describe('a11y: ui primitives', () => {
  it('Button non ha violazioni axe', async () => {
    const { container } = render(<Button>Salva</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Button icon-only con aria-label non ha violazioni axe', async () => {
    const { container } = render(
      <Button size="icon" aria-label="Modifica">
        <svg aria-hidden="true" width="16" height="16">
          <rect width="16" height="16" />
        </svg>
      </Button>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Input + Label associati non hanno violazioni axe', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Textarea + Label associati non hanno violazioni axe', async () => {
    const { container } = render(
      <div>
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Badge non ha violazioni axe', async () => {
    const { container } = render(<Badge>In corso</Badge>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Alert non ha violazioni axe', async () => {
    const { container } = render(
      <Alert>
        <AlertTitle>Attenzione</AlertTitle>
        <AlertDescription>Verifica i dati prima di proseguire.</AlertDescription>
      </Alert>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('a11y: FieldError + form pattern', () => {
  it('FieldError vuoto non rende nulla (no orphan id)', async () => {
    const { container } = render(<FieldError id="x-error" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('FieldError con messaggio ha role=alert e id', async () => {
    const { container, getByRole } = render(
      <FieldError id="email-error">Email obbligatoria</FieldError>,
    );
    const alert = getByRole('alert');
    expect(alert).toHaveAttribute('id', 'email-error');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Form con errore: input collegato via aria-describedby non viola axe', async () => {
    const { container } = render(
      <form noValidate>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          aria-invalid={true}
          aria-describedby="email-error"
          defaultValue="not-an-email"
        />
        <FieldError id="email-error">Inserisci un indirizzo email valido</FieldError>
        <Button type="submit">Invia</Button>
      </form>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Form senza errori non viola axe', async () => {
    const { container } = render(
      <form noValidate>
        <Label htmlFor="name">Nome</Label>
        <Input id="name" defaultValue="" />
        <FieldError id="name-error" />
        <Button type="submit">Invia</Button>
      </form>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
