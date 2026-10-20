using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;

namespace RevitMcpAddin.SheetNumerator.Ui
{
    /// <summary>
    /// INotifyPropertyChanged-ийн суурь.  Репод MVVM фреймворк (CommunityToolkit г.м.) БАЙХГҮЙ тул шинэ пакет
    /// нэмэхгүй — Intelligence/FamilyHub-ийн адил жижиг өөрийн суурь.
    /// </summary>
    public abstract class ObservableObject : INotifyPropertyChanged
    {
        public event PropertyChangedEventHandler PropertyChanged;

        protected bool Set<T>(ref T field, T value, [CallerMemberName] string name = null)
        {
            if (Equals(field, value))
                return false;
            field = value;
            Raise(name);
            return true;
        }

        protected void Raise([CallerMemberName] string name = null)
        {
            PropertyChangedEventHandler h = PropertyChanged;
            if (h != null)
                h(this, new PropertyChangedEventArgs(name));
        }
    }

    /// <summary>Энгийн ICommand: Execute + (сонголтоор) CanExecute.  CanExecute өөрчлөгдвөл <see cref="RaiseCanExecuteChanged"/>.</summary>
    public sealed class RelayCommand : ICommand
    {
        private readonly Action<object> _execute;
        private readonly Func<object, bool> _canExecute;

        public RelayCommand(Action execute, Func<bool> canExecute = null)
            : this(p => execute(), canExecute == null ? (Func<object, bool>)null : p => canExecute())
        {
        }

        public RelayCommand(Action<object> execute, Func<object, bool> canExecute = null)
        {
            _execute = execute;
            _canExecute = canExecute;
        }

        public event EventHandler CanExecuteChanged;

        public bool CanExecute(object parameter)
        {
            return _canExecute == null || _canExecute(parameter);
        }

        public void Execute(object parameter)
        {
            if (CanExecute(parameter))
                _execute(parameter);
        }

        public void RaiseCanExecuteChanged()
        {
            EventHandler h = CanExecuteChanged;
            if (h != null)
                h(this, EventArgs.Empty);
        }
    }
}
